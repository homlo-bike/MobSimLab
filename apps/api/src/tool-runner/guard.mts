/**
 * Network guard of the tool host, loaded before any tool code. Node's permission model (`--permission`) blocks
 * the file system, child processes, workers and native add-ons but not the network, so this replaces every way
 * Node opens a connection or resolves a name with a function that throws. Where the system allows it the
 * runner also starts the host in its own empty network namespace (`unshare --net`), which needs no guard.
 */
import dgram from "node:dgram";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

const refuse = (): never => {
  throw new Error("tools have no network access");
};

type Writable = Record<string, unknown>;
const block = (target: object, names: string[]) => {
  for (const name of names) {
    Object.defineProperty(target, name, { value: refuse, writable: false, configurable: false });
  }
};

block(net.Socket.prototype, ["connect"]);
block(net, ["connect", "createConnection", "createServer"]);
block(tls, ["connect", "createServer"]);
block(dgram, ["createSocket"]);
block(dns, ["lookup", "resolve", "resolve4", "resolve6", "resolveAny", "reverse"]);
block(dns.promises, ["lookup", "resolve", "resolve4", "resolve6", "resolveAny", "reverse"]);
block(http, ["request", "get", "createServer"]);
block(https, ["request", "get", "createServer"]);
for (const name of ["fetch", "WebSocket", "EventSource"])
  if (name in globalThis) block(globalThis as Writable, [name]);
