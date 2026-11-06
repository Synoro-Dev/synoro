import { cancelDeletion } from "./cancel-deletion";
import { deletionStatus } from "./deletion-status";
import { requestDeletion } from "./request-deletion";

export const accountRouter = {
  deletionStatus,
  requestDeletion,
  cancelDeletion,
};
