import { acceptInvitation } from "./accept-invitation";
import { addMember } from "./add-member";
import { byHost } from "./by-host";
import { bySlug } from "./by-slug";
import { create } from "./create";
import { get } from "./get";
import { invitations } from "./invitations";
import { join } from "./join";
import { members } from "./members";
import { mine } from "./mine";
import { setContact } from "./set-contact";
import { setFreeBooking } from "./set-free-booking";
import { setNotifications } from "./set-notifications";
import { setPayAtVisit } from "./set-pay-at-visit";
import { setSlug } from "./set-slug";
import { setTheme } from "./set-theme";
import { setTimezone } from "./set-timezone";
import { setVideoUrl } from "./set-video-url";
import { slugOrder } from "./slug-order";
import { slugOrderSandboxPay } from "./slug-order-sandbox-pay";
import { theme } from "./theme";

export const practiceRouter = {
  create,
  mine,
  bySlug,
  byHost,
  get,
  join,
  members,
  addMember,
  invitations,
  acceptInvitation,
  setVideoUrl,
  setContact,
  setFreeBooking,
  setPayAtVisit,
  setNotifications,
  setTimezone,
  setSlug,
  slugOrder,
  slugOrderSandboxPay,
  theme,
  setTheme,
};
