import { block } from "./block";
import { book } from "./book";
import { bookAtVisit } from "./book-at-visit";
import { bookFree } from "./book-free";
import { bookIntro } from "./book-intro";
import { bookSeries } from "./book-series";
import { calendar } from "./calendar";
import { cancel } from "./cancel";
import { cancelSeries } from "./cancel-series";
import { cancelGuest, guest } from "./guest";
import { guestSeriesPreview } from "./guest-series-preview";
import { markNoShow } from "./mark-no-show";
import { mine } from "./mine";
import { reschedule } from "./reschedule";
import { rescheduleSlots } from "./reschedule-slots";
import { reserve } from "./reserve";
import { reserveSeries } from "./reserve-series";
import { seriesPreview } from "./series-preview";
import { setMeetingUrl } from "./set-meeting-url";
import { slots } from "./slots";
import { windows } from "./windows";

export const bookingRouter = {
  slots,
  book,
  seriesPreview,
  bookSeries,
  cancelSeries,
  reserve,
  reserveSeries,
  guestSeriesPreview,
  bookIntro,
  bookAtVisit,
  guest,
  cancelGuest,
  bookFree,
  block,
  cancel,
  reschedule,
  rescheduleSlots,
  markNoShow,
  calendar,
  windows,
  mine,
  setMeetingUrl,
};
