-- A message whose send timed out after the request went out is not failed and not sent: unknown,
-- and a person reconciles it against the provider's log before anything is sent again.
ALTER TYPE "MessageStatus" ADD VALUE 'UNKNOWN';
ALTER TYPE "ExceptionKind" ADD VALUE 'DELIVERY_UNKNOWN';
