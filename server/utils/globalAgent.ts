/**
 * Configure a global undici Agent so that all native `fetch()` calls share a
 * connection pool with keep-alive and bounded max connections per origin.
 *
 * Without this, every `fetch()` opens a fresh TCP socket.  Replit's port
 * scanner detects each ephemeral local port and shows it in the Ports panel,
 * creating the illusion of dozens of "leaked" processes.
 *
 * Import this module as early as possible in the server entry point — before
 * any code that calls `fetch()`.
 */

import { Agent, setGlobalDispatcher } from "undici";

export const agent = new Agent({
  keepAliveTimeout: 8_000,        // close idle sockets after 8 s — balances reuse vs ephemeral port reclamation
  keepAliveMaxTimeout: 15_000,    // hard cap — below Replit's idle connection timeout
  connections: 4,                 // max 4 connections per origin — allows concurrent Slack/webhook/monitor requests
  pipelining: 1,                  // no HTTP pipelining
  connect: {
    timeout: 10_000,              // TCP connect timeout
  },
});

setGlobalDispatcher(agent);
