import { block } from "./block";
import { book } from "./book";
import { bookFree } from "./book-free";
import { bookSeries } from "./book-series";
import { calendar } from "./calendar";
import { cancel } from "./cancel";
import { cancelSeries } from "./cancel-series";
import { cancelGuest, guest } from "./guest";
import { markNoShow } from "./mark-no-show";
import { mine } from "./mine";
import { reserve } from "./reserve";
import { seriesPreview } from "./series-preview";
import { setMeetingUrl } from "./set-meeting-url";
import { slots } from "./slots";

export const bookingRouter = {
  slots,
  book,
  seriesPreview,
  bookSeries,
  cancelSeries,
  reserve,
  guest,
  cancelGuest,
  bookFree,
  block,
  cancel,
  markNoShow,
  calendar,
  mine,
  setMeetingUrl,
};
