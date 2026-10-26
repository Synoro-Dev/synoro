import { acceptInvitation } from "./accept-invitation";
import { addMember } from "./add-member";
import { bySlug } from "./by-slug";
import { create } from "./create";
import { get } from "./get";
import { invitations } from "./invitations";
import { join } from "./join";
import { members } from "./members";
import { mine } from "./mine";

export const practiceRouter = {
  create,
  mine,
  bySlug,
  get,
  join,
  members,
  addMember,
  invitations,
  acceptInvitation,
};
