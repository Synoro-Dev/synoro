import { me } from "./me";
import { updateAccount } from "./update-account";
import { updatePhone } from "./update-phone";
import { updateProfile } from "./update-profile";

export const userRouter = {
  me,
  updateProfile,
  updateAccount,
  updatePhone,
};
