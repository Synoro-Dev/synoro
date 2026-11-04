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
import { setTheme } from "./set-theme";
import { setTimezone } from "./set-timezone";
import { setVideoUrl } from "./set-video-url";
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
  setNotifications,
  setTimezone,
  theme,
  setTheme,
};
