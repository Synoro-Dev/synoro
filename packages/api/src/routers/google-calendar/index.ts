import { busy } from "./busy";
import { calendars } from "./calendars";
import { connect } from "./connect";
import { disconnect } from "./disconnect";
import { settings } from "./settings";
import { update } from "./update";

export const googleCalendarRouter = {
  settings,
  connect,
  calendars,
  update,
  disconnect,
  busy,
};
