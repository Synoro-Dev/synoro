import { create } from "./create";
import { list } from "./list";
import { remove } from "./remove";
import { sessions } from "./sessions";
import { update } from "./update";

export const noteRouter = { list, sessions, create, update, remove };
