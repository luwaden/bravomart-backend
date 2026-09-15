import { Router } from 'express';
import * as orderController from '../controllers/order.controller.js';
import { authenticate } from '../middlewares/authenticate.js';
import { validate } from '../middlewares/validate.js';
import {
  checkoutSchema,
  orderListQuerySchema,
  orderIdParamsSchema,
  shipmentParamsSchema,
} from '../schemas/order.schema.js';

const router = Router();

router.use(authenticate);

router.post('/', validate({ body: checkoutSchema }), orderController.checkout);
router.get('/', validate({ query: orderListQuerySchema }), orderController.listMyOrders);
router.get('/:orderId', validate({ params: orderIdParamsSchema }), orderController.getMyOrder);
router.post(
  '/:orderId/shipments/:shipmentId/confirm-delivery',
  validate({ params: shipmentParamsSchema }),
  orderController.confirmDelivery,
);
router.post(
  '/:orderId/shipments/:shipmentId/dispute',
  validate({ params: shipmentParamsSchema }),
  orderController.disputeShipment,
);

export default router;
