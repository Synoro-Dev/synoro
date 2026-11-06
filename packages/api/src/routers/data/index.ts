import { audit } from "./audit";
import { confirmAccess } from "./confirm-access";
import { disableFeed } from "./disable-feed";
import { exportPart } from "./export-part";
import { exports_ } from "./exports";
import { issueFeed } from "./issue-feed";
import { overview } from "./overview";
import { sendAccessCode } from "./send-access-code";
import { setBackup } from "./set-backup";
import { setFeedNames } from "./set-feed-names";
import { startExport } from "./start-export";

export const dataRouter = {
  overview,
  sendAccessCode,
  confirmAccess,
  startExport,
  exports: exports_,
  exportPart,
  issueFeed,
  disableFeed,
  setFeedNames,
  setBackup,
  audit,
};
