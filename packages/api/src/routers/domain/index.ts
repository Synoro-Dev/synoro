import { connect } from "./connect";
import { disconnect } from "./disconnect";
import { get } from "./get";
import { verify } from "./verify";

export const domainRouter = { get, connect, verify, disconnect };
