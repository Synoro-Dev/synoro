import { create } from "./create";
import { deleteWorkflow } from "./delete";
import { list } from "./list";
import { update } from "./update";

export const workflowRouter = {
  list,
  create,
  update,
  delete: deleteWorkflow,
};
