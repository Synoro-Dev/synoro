import { checkout } from "./checkout";
import { get } from "./get";
import { refund } from "./refund";
import { sandboxPay } from "./sandbox-pay";
import { status } from "./status";

export const billingRouter = {
  get,
  checkout,
  status,
  refund,
  sandboxPay,
};
