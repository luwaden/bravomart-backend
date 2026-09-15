import { Router } from 'express';
import * as dispatchController from '../controllers/dispatch.controller.js';
import { authenticate } from '../middlewares/authenticate.js';
import { authorize } from '../middlewares/authorize.js';
import { validate } from '../middlewares/validate.js';
import {
  updateAvailabilitySchema,
  updateRiderLocationSchema,
  shipmentIdParamsSchema,
} from '../schemas/dispatch.schema.js';

const router = Router();

router.use(authenticate, authorize('DISPATCHER'));

router.patch('/me/availability', validate({ body: updateAvailabilitySchema }), dispatchController.updateAvailability);
router.patch('/me/location', validate({ body: updateRiderLocationSchema }), dispatchController.updateLocation);

router.get('/available-shipments', dispatchController.listAvailableShipments);
router.post(
  '/shipments/:shipmentId/accept',
  validate({ params: shipmentIdParamsSchema }),
  dispatchController.acceptShipment,
);
router.post(
  '/shipments/:shipmentId/picked-up',
  validate({ params: shipmentIdParamsSchema }),
  dispatchController.markPickedUp,
);
router.post(
  '/shipments/:shipmentId/delivered',
  validate({ params: shipmentIdParamsSchema }),
  dispatchController.markDelivered,
);

export default router;
