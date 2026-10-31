import { checkout } from "./checkout";
import { get } from "./get";
import { sandboxPay } from "./sandbox-pay";
import { status } from "./status";

export const billingRouter = {
  get,
  checkout,
  status,
  sandboxPay,
};
