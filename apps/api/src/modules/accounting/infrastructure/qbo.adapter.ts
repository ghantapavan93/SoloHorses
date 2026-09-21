import { Injectable, Logger } from '@nestjs/common';
import OAuthClient from 'intuit-oauth';
import { PrismaService } from '../../../platform/persistence/prisma.service';
import { EnvService } from '../../../platform/config/env.module';
import {
  AccountingAuthError,
  AccountingRateLimitError,
  AccountingTransientError,
  AccountingValidationError,
  assertReferenceLength,
  centsToDecimal,
  decimalToCents,
  type AccountingProvider,
  type CreateCreditInput,
  type CreateCustomerInput,
  type CreateInvoiceInput,
  type CreatePaymentInput,
  type RemoteCredit,
  type RemoteCustomer,
  type RemoteInvoice,
  type RemoteItem,
  type RemotePayment,
} from './accounting.provider';

/**
 * QuickBooks Online Accounting API v3 through the official OAuth client.
 *
 * Facts this adapter is built on (verified against Intuit's docs, Sept 2026):
 *  - minorversion 75 is the floor; older values are ignored
 *  - access tokens live one hour; refresh tokens rotate and are re-persisted every refresh
 *  - there is no idempotency key: we query by our own DocNumber / PaymentRefNum before create
 *  - DocNumber and PaymentRefNum are 21 characters — our codes fit, Stripe ids do not
 *  - 429 means back off for the window; 5010 means a stale SyncToken; 6240 a duplicate name
 *  - every response carries `intuit_tid`, the id Intuit support asks for
 */

const MINOR_VERSION = 75;
const SCOPES = [OAuthClient.scopes.Accounting];

interface QboFault {
  Fault?: { Error?: { Message?: string; Detail?: string; code?: string }[]; type?: string };
}

@Injectable()
export class QboAdapter implements AccountingProvider {
  readonly mode = 'live' as const;
  readonly label = 'QuickBooks Online (sandbox)';
  private readonly logger = new Logger(QboAdapter.name);
  private readonly client: OAuthClient;
  private realmId: string | null = null;

  constructor(
    private readonly envService: EnvService,
    private readonly prisma: PrismaService,
  ) {
    const { env } = envService;
    this.client = new OAuthClient({
      clientId: env.QBO_CLIENT_ID,
      clientSecret: env.QBO_CLIENT_SECRET,
      environment: env.QBO_ENVIRONMENT,
      redirectUri: env.QBO_REDIRECT_URI,
      includeRefreshTokenHardExpiresIn: true,
    });
  }

  // ───────────────────────────── OAuth ─────────────────────────────

  authorizeUrl(state: string): string {
    return this.client.authorizeUri({ scope: SCOPES, state });
  }

  /** Exchange the callback URL for tokens and persist them. Called once per connection. */
  async completeAuthorization(callbackUrl: string): Promise<{ realmId: string }> {
    const response = await this.client.createToken(callbackUrl);
    const token = response.getToken();
    const realmId = this.client.getToken().realmId || new URL(callbackUrl).searchParams.get('realmId') || '';
    if (!realmId) throw new AccountingAuthError('callback did not include a realmId');
    await this.persistToken(
      realmId,
      requireField(token.access_token, 'access_token'),
      requireField(token.refresh_token, 'refresh_token'),
      token.expires_in ?? 3600,
      token.x_refresh_token_expires_in ?? 8_726_400,
    );
    this.realmId = realmId;
    return { realmId };
  }

  async isConnected(): Promise<boolean> {
    const row = await this.prisma.client.accountingConnection.findFirst({ where: { provider: 'QBO' } });
    return row !== null && row.refreshExpiresAt > new Date();
  }

  private async persistToken(
    realmId: string,
    accessToken: string,
    refreshToken: string,
    expiresIn: number,
    refreshExpiresIn: number,
  ): Promise<void> {
    const now = Date.now();
    await this.prisma.client.accountingConnection.upsert({
      where: { realmId },
      create: {
        provider: 'QBO',
        realmId,
        accessToken,
        refreshToken,
        accessExpiresAt: new Date(now + expiresIn * 1000),
        refreshExpiresAt: new Date(now + refreshExpiresIn * 1000),
      },
      update: {
        accessToken,
        refreshToken,
        accessExpiresAt: new Date(now + expiresIn * 1000),
        refreshExpiresAt: new Date(now + refreshExpiresIn * 1000),
      },
    });
  }

  /** Load the stored token, refreshing (and re-persisting the rotated refresh token) when needed. */
  private async ensureToken(): Promise<string> {
    const row = await this.prisma.client.accountingConnection.findFirst({ where: { provider: 'QBO' } });
    if (!row) throw new AccountingAuthError('QuickBooks is not connected. Visit /integrations/qbo/connect.');
    if (row.refreshExpiresAt <= new Date())
      throw new AccountingAuthError('QuickBooks refresh token expired; reconnect.');
    this.realmId = row.realmId;
    const stillValid = row.accessExpiresAt.getTime() - Date.now() > 60_000;
    if (stillValid) {
      this.client.setToken({
        access_token: row.accessToken,
        refresh_token: row.refreshToken,
        realmId: row.realmId,
        token_type: 'bearer',
        expires_in: Math.floor((row.accessExpiresAt.getTime() - Date.now()) / 1000),
        x_refresh_token_expires_in: Math.floor((row.refreshExpiresAt.getTime() - Date.now()) / 1000),
        createdAt: Date.now(),
      });
      return row.realmId;
    }
    const refreshed = await this.client.refreshUsingToken(row.refreshToken);
    const token = refreshed.getToken();
    await this.persistToken(
      row.realmId,
      requireField(token.access_token, 'access_token'),
      requireField(token.refresh_token, 'refresh_token'),
      token.expires_in ?? 3600,
      token.x_refresh_token_expires_in ?? 8_726_400,
    );
    return row.realmId;
  }

  // ───────────────────────────── HTTP ─────────────────────────────

  private baseUrl(realmId: string): string {
    const host =
      this.envService.env.QBO_ENVIRONMENT === 'production'
        ? 'https://quickbooks.api.intuit.com'
        : 'https://sandbox-quickbooks.api.intuit.com';
    return `${host}/v3/company/${realmId}`;
  }

  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    query: Record<string, string> = {},
  ): Promise<T> {
    const realmId = await this.ensureToken();
    const params = new URLSearchParams({ ...query, minorversion: String(MINOR_VERSION) });
    const url = `${this.baseUrl(realmId)}/${path}?${params.toString()}`;
    try {
      const response = await this.client.makeApiCall({
        url,
        method,
        body,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        maxRetries: 0,
      });
      return response.json as T;
    } catch (error) {
      throw this.mapError(error);
    }
  }

  private async query<T>(sql: string): Promise<T[]> {
    const result = await this.call<{ QueryResponse: Record<string, T[] | number | undefined> }>(
      'GET',
      'query',
      undefined,
      { query: sql },
    );
    const rows = Object.values(result.QueryResponse ?? {}).find((v): v is T[] => Array.isArray(v));
    return rows ?? [];
  }

  private mapError(error: unknown): Error {
    const e = error as {
      response?: { status?: number; headers?: Record<string, string>; json?: QboFault };
      status?: number;
      intuit_tid?: string;
      message?: string;
      authResponse?: { json?: QboFault; response?: { status?: number } };
    };
    const status = e.response?.status ?? e.status ?? e.authResponse?.response?.status ?? 0;
    const tid = e.intuit_tid ?? e.response?.headers?.['intuit_tid'] ?? null;
    const fault = e.response?.json?.Fault?.Error?.[0] ?? e.authResponse?.json?.Fault?.Error?.[0];
    if (status === 429) {
      const retryAfter = Number(e.response?.headers?.['retry-after'] ?? 60);
      return new AccountingRateLimitError(retryAfter * 1000, tid);
    }
    if (status === 401 || status === 403)
      return new AccountingAuthError(`QuickBooks rejected the token (${status}); intuit_tid=${tid ?? '?'}`);
    if (status >= 500 || status === 0)
      return new AccountingTransientError(`QuickBooks ${status || 'network'} error: ${e.message ?? 'unknown'}`, tid);
    return new AccountingValidationError(
      fault?.code ?? String(status),
      `${fault?.Message ?? e.message ?? 'validation error'}${fault?.Detail ? ` — ${fault.Detail}` : ''}`,
      tid,
    );
  }

  // ───────────────────────────── AccountingProvider ─────────────────────────────

  async findCustomerByName(displayName: string): Promise<RemoteCustomer | null> {
    const rows = await this.query<{ Id: string; DisplayName: string; SyncToken: string }>(
      `select * from Customer where DisplayName = '${escapeSql(displayName)}'`,
    );
    const row = rows[0];
    return row ? { id: row.Id, displayName: row.DisplayName, syncToken: row.SyncToken } : null;
  }

  async createCustomer(input: CreateCustomerInput): Promise<RemoteCustomer> {
    const created = await this.call<{ Customer: { Id: string; DisplayName: string; SyncToken: string } }>(
      'POST',
      'customer',
      {
        DisplayName: input.displayName,
        PrimaryEmailAddr: input.email ? { Address: input.email } : undefined,
        PrimaryPhone: input.phone ? { FreeFormNumber: input.phone } : undefined,
      },
    );
    return {
      id: created.Customer.Id,
      displayName: created.Customer.DisplayName,
      syncToken: created.Customer.SyncToken,
    };
  }

  async ensureItem(name: string): Promise<RemoteItem> {
    const rows = await this.query<{ Id: string; Name: string }>(`select * from Item where Name = '${escapeSql(name)}'`);
    const existing = rows[0];
    if (existing) return { id: existing.Id, name: existing.Name };
    const accounts = await this.query<{ Id: string; Name: string }>(
      `select * from Account where AccountType = 'Income' maxresults 1`,
    );
    const income = accounts[0];
    if (!income)
      throw new AccountingValidationError(
        'NO_INCOME_ACCOUNT',
        'the company file has no income account to attach service items to',
        null,
      );
    const created = await this.call<{ Item: { Id: string; Name: string } }>('POST', 'item', {
      Name: name,
      Type: 'Service',
      IncomeAccountRef: { value: income.Id },
    });
    return { id: created.Item.Id, name: created.Item.Name };
  }

  async findInvoiceByDocNumber(docNumber: string): Promise<RemoteInvoice | null> {
    const rows = await this.query<QboInvoice>(`select * from Invoice where DocNumber = '${escapeSql(docNumber)}'`);
    const row = rows[0];
    return row ? toRemoteInvoice(row) : null;
  }

  async createInvoice(input: CreateInvoiceInput): Promise<RemoteInvoice> {
    const created = await this.call<{ Invoice: QboInvoice }>('POST', 'invoice', {
      DocNumber: assertReferenceLength(input.docNumber),
      CustomerRef: { value: input.customerId },
      TxnDate: input.txnDate,
      DueDate: input.dueDate,
      Line: [
        {
          Amount: centsToDecimal(input.amountCents),
          DetailType: 'SalesItemLineDetail',
          Description: input.description,
          SalesItemLineDetail: {
            ItemRef: { value: input.itemId },
            Qty: 1,
            UnitPrice: centsToDecimal(input.amountCents),
          },
        },
      ],
    });
    return toRemoteInvoice(created.Invoice);
  }

  async updateInvoiceAmount(id: string, syncToken: string, amountCents: number): Promise<RemoteInvoice> {
    const current = await this.call<{ Invoice: QboInvoice }>('GET', `invoice/${id}`);
    const line = current.Invoice.Line.find((l) => l.DetailType === 'SalesItemLineDetail');
    const updated = await this.call<{ Invoice: QboInvoice }>('POST', 'invoice', {
      Id: id,
      SyncToken: syncToken,
      sparse: true,
      Line: [
        {
          ...(line ?? { DetailType: 'SalesItemLineDetail', SalesItemLineDetail: {} }),
          Amount: centsToDecimal(amountCents),
          SalesItemLineDetail: { ...(line?.SalesItemLineDetail ?? {}), Qty: 1, UnitPrice: centsToDecimal(amountCents) },
        },
      ],
    });
    return toRemoteInvoice(updated.Invoice);
  }

  async findPaymentByReference(referenceNumber: string): Promise<RemotePayment | null> {
    const rows = await this.query<QboPayment>(
      `select * from Payment where PaymentRefNum = '${escapeSql(referenceNumber)}'`,
    );
    const row = rows[0];
    return row ? toRemotePayment(row) : null;
  }

  async createPayment(input: CreatePaymentInput): Promise<RemotePayment> {
    const created = await this.call<{ Payment: QboPayment }>('POST', 'payment', {
      PaymentRefNum: assertReferenceLength(input.referenceNumber),
      CustomerRef: { value: input.customerId },
      TotalAmt: centsToDecimal(input.amountCents),
      TxnDate: input.txnDate,
      Line: input.linkedInvoiceId
        ? [
            {
              Amount: centsToDecimal(input.amountCents),
              LinkedTxn: [{ TxnId: input.linkedInvoiceId, TxnType: 'Invoice' }],
            },
          ]
        : [],
    });
    return toRemotePayment(created.Payment);
  }

  async findCreditByDocNumber(docNumber: string): Promise<RemoteCredit | null> {
    const rows = await this.query<{
      Id: string;
      DocNumber: string;
      CustomerRef: { value: string };
      TotalAmt: number;
      SyncToken: string;
    }>(`select * from CreditMemo where DocNumber = '${escapeSql(docNumber)}'`);
    const row = rows[0];
    return row
      ? {
          id: row.Id,
          docNumber: row.DocNumber,
          customerId: row.CustomerRef.value,
          totalCents: decimalToCents(row.TotalAmt),
          syncToken: row.SyncToken,
        }
      : null;
  }

  async createCredit(input: CreateCreditInput): Promise<RemoteCredit> {
    const created = await this.call<{
      CreditMemo: {
        Id: string;
        DocNumber: string;
        CustomerRef: { value: string };
        TotalAmt: number;
        SyncToken: string;
      };
    }>('POST', 'creditmemo', {
      DocNumber: assertReferenceLength(input.docNumber),
      CustomerRef: { value: input.customerId },
      TxnDate: input.txnDate,
      Line: [
        {
          Amount: centsToDecimal(input.amountCents),
          DetailType: 'SalesItemLineDetail',
          Description: input.description,
          SalesItemLineDetail: {
            ItemRef: { value: input.itemId },
            Qty: 1,
            UnitPrice: centsToDecimal(input.amountCents),
          },
        },
      ],
    });
    const c = created.CreditMemo;
    return {
      id: c.Id,
      docNumber: c.DocNumber,
      customerId: c.CustomerRef.value,
      totalCents: decimalToCents(c.TotalAmt),
      syncToken: c.SyncToken,
    };
  }

  async listInvoices(docNumbers: string[]): Promise<RemoteInvoice[]> {
    if (docNumbers.length === 0) return [];
    const rows = await this.query<QboInvoice>(
      `select * from Invoice where DocNumber in (${docNumbers.map((d) => `'${escapeSql(d)}'`).join(',')}) maxresults 1000`,
    );
    return rows.map(toRemoteInvoice);
  }

  async listPayments(referenceNumbers: string[]): Promise<RemotePayment[]> {
    if (referenceNumbers.length === 0) return [];
    const rows = await this.query<QboPayment>(
      `select * from Payment where PaymentRefNum in (${referenceNumbers.map((d) => `'${escapeSql(d)}'`).join(',')}) maxresults 1000`,
    );
    return rows.map(toRemotePayment);
  }
}

interface QboInvoice {
  Id: string;
  DocNumber: string;
  CustomerRef: { value: string };
  TotalAmt: number;
  Balance: number;
  SyncToken: string;
  TxnDate: string;
  DueDate: string;
  Line: { DetailType: string; Amount?: number; SalesItemLineDetail?: Record<string, unknown> }[];
}

interface QboPayment {
  Id: string;
  PaymentRefNum?: string;
  CustomerRef: { value: string };
  TotalAmt: number;
  SyncToken: string;
  TxnDate: string;
  Line?: { Amount: number; LinkedTxn?: { TxnId: string; TxnType: string }[] }[];
}

function toRemoteInvoice(row: QboInvoice): RemoteInvoice {
  return {
    id: row.Id,
    docNumber: row.DocNumber,
    customerId: row.CustomerRef.value,
    totalCents: decimalToCents(row.TotalAmt),
    balanceCents: decimalToCents(row.Balance),
    syncToken: row.SyncToken,
    txnDate: row.TxnDate,
    dueDate: row.DueDate,
  };
}

function toRemotePayment(row: QboPayment): RemotePayment {
  return {
    id: row.Id,
    referenceNumber: row.PaymentRefNum ?? '',
    customerId: row.CustomerRef.value,
    totalCents: decimalToCents(row.TotalAmt),
    linkedInvoiceIds: (row.Line ?? []).flatMap((l) =>
      (l.LinkedTxn ?? []).filter((t) => t.TxnType === 'Invoice').map((t) => t.TxnId),
    ),
    syncToken: row.SyncToken,
    txnDate: row.TxnDate,
  };
}

function requireField(value: string | undefined, name: string): string {
  if (!value) throw new AccountingAuthError(`token response missing ${name}`);
  return value;
}

/** QBO's query language takes single-quoted literals; only the quote needs escaping. */
function escapeSql(value: string): string {
  return value.replace(/'/g, "\\'");
}
