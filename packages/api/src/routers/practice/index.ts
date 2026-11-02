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
import { setFreeBooking } from "./set-free-booking";
import { setVideoUrl } from "./set-video-url";

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
  setFreeBooking,
};
