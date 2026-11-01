import { cancelAutorenew } from "./cancel-autorenew";
import { checkout } from "./checkout";
import { get } from "./get";
import { refund } from "./refund";
import { sandboxPay } from "./sandbox-pay";
import { status } from "./status";

export const billingRouter = {
  get,
  checkout,
  cancelAutorenew,
  status,
  refund,
  sandboxPay,
};
