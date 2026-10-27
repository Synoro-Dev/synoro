import { checkout } from "./checkout";
import { connect } from "./connect";
import { disconnect } from "./disconnect";
import { list } from "./list";
import { mine } from "./mine";
import { packages } from "./packages";
import { savePackages } from "./save-packages";
import { settings } from "./settings";
import { status } from "./status";

export const paymentRouter = {
  settings,
  connect,
  disconnect,
  packages,
  savePackages,
  checkout,
  status,
  mine,
  list,
};
