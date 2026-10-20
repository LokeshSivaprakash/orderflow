import express, { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { config } from '../config';
import { authenticate } from '../lib/auth';
import { asyncHandler, HttpError, validate } from '../lib/http';
import { createCheckout, handleEvent, type Deps } from '../paymentService';

const checkoutSchema = z.object({ orderId: z.string().uuid() });

export function paymentsRouter(deps: Deps) {
  const r = Router();

  // Stripe -> us. Needs the RAW body to verify the signature, so it is mounted before any JSON parsing.
  r.post(
    '/webhook',
    express.raw({ type: '*/*', limit: '1mb' }),
    asyncHandler(async (req, res) => {
      let event;
      try {
        event = deps.provider.parseWebhook(req.body as Buffer, req.header('stripe-signature'));
      } catch {
        throw new HttpError(400, 'Invalid webhook signature');
      }
      const outcome = await handleEvent(deps, event);
      res.json({ received: true, outcome });
    }),
  );

  const json = express.json({ limit: '10kb' });

  r.post(
    '/checkout',
    authenticate(config.jwtSecret),
    json,
    validate(checkoutSchema),
    asyncHandler(async (req, res) => {
      const { orderId } = req.body as z.infer<typeof checkoutSchema>;
      const result = await createCheckout(deps, req.user!.id, orderId);
      res.status(result.reused ? 200 : 201).json({ url: result.url });
    }),
  );

  return r;
}

export type { Pool };
