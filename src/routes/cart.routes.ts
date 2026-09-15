import { Router } from 'express';
import * as cartController from '../controllers/cart.controller.js';
import { authenticate } from '../middlewares/authenticate.js';
import { validate } from '../middlewares/validate.js';
import { addCartItemSchema, updateCartItemBodySchema, cartItemParamsSchema } from '../schemas/cart.schema.js';

const router = Router();

// Every cart route requires a logged-in user — there is no concept of an
// anonymous/guest cart in this API. The frontend already gates checkout
// behind sign-in (see CheckoutPage.jsx's AuthModal step), so a cart is only
// ever meaningful once we know whose it is.
router.use(authenticate);

router.get('/', cartController.getCart);
router.post('/items', validate({ body: addCartItemSchema }), cartController.addItem);
router.patch(
  '/items/:productId',
  validate({ params: cartItemParamsSchema, body: updateCartItemBodySchema }),
  cartController.updateItem,
);
router.delete('/items/:productId', validate({ params: cartItemParamsSchema }), cartController.removeItem);
router.delete('/', cartController.clearCart);

export default router;
