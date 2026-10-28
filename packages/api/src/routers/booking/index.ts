import { block } from "./block";
import { book } from "./book";
import { bookFree } from "./book-free";
import { calendar } from "./calendar";
import { cancel } from "./cancel";
import { cancelGuest, guest } from "./guest";
import { mine } from "./mine";
import { reserve } from "./reserve";
import { setMeetingUrl } from "./set-meeting-url";
import { slots } from "./slots";

export const bookingRouter = {
  slots,
  book,
  reserve,
  guest,
  cancelGuest,
  bookFree,
  block,
  cancel,
  calendar,
  mine,
  setMeetingUrl,
};
