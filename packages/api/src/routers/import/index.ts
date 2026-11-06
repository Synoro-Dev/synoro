import { clients } from "./clients";
import { commit } from "./commit";
import { fromGoogle } from "./from-google";
import { list } from "./list";
import { preview } from "./preview";
import { previewArchive } from "./preview-archive";
import { previewEvents } from "./preview-events";
import { rejected } from "./rejected";
import { undo } from "./undo";
import { upload } from "./upload";

export const importRouter = {
  upload,
  preview,
  previewEvents,
  previewArchive,
  fromGoogle,
  commit,
  undo,
  rejected,
  list,
  clients,
};
