import { clients } from "./clients";
import { commit } from "./commit";
import { list } from "./list";
import { preview } from "./preview";
import { rejected } from "./rejected";
import { undo } from "./undo";
import { upload } from "./upload";

export const importRouter = {
  upload,
  preview,
  commit,
  undo,
  rejected,
  list,
  clients,
};
