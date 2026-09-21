import { Module } from '@nestjs/common';
import { PaymentsController } from './api/payments.controller';
import { SettlementController } from './api/settlement.controller';
import { PaymentsService } from './application/payments.service';
import { SettlementService } from './application/settlement.service';
import { IntegrationEventsService } from './infrastructure/integration-events.service';
import { AuctionAdapter } from './infrastructure/auction.adapter';
import { StripeEventsProcessor } from './infrastructure/stripe-events.processor';
import { StripeService } from './infrastructure/stripe.service';

/**
 * Billing: invoices, payments, refunds, and the sale's settlement — the published rule that
 * papers wait for cleared funds. Stripe is behind an adapter; its events enter through a
 * write-once inbox and leave as domain events in the ledger's own words.
 */
@Module({
  controllers: [PaymentsController, SettlementController],
  providers: [
    StripeService,
    IntegrationEventsService,
    PaymentsService,
    StripeEventsProcessor,
    SettlementService,
    AuctionAdapter,
  ],
  exports: [StripeService, IntegrationEventsService, PaymentsService, SettlementService, AuctionAdapter],
})
export class BillingModule {}
