import { connect, createServer, type Socket } from "node:net";

/** Plain PostgreSQL v3 loopback proxy for a lost COMMIT acknowledgement.
 * Only backend framing is inspected; startup, authentication and frontend query
 * traffic pass through unchanged. Production clients never use this helper. */
export async function startPostgresCommitLossProxy(databaseUrl: string) {
  const upstreamUrl = new URL(databaseUrl);
  const sockets = new Set<Socket>();
  let armed = false;
  let droppedCommits = 0;
  let acceptedConnections = 0;
  let closed = false;

  function own(socket: Socket) {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    return socket;
  }

  const server = createServer((socket) => {
    acceptedConnections++;
    const client = own(socket);
    const backend = own(
      connect({
        host: upstreamUrl.hostname.replace(/^\[|\]$/gu, ""),
        port: Number(upstreamUrl.port || "5432"),
      }),
    );
    client.setNoDelay(true);
    backend.setNoDelay(true);
    client.on("error", () => backend.destroy());
    backend.on("error", () => client.destroy());
    client.once("close", () => backend.destroy());
    backend.once("close", () => client.destroy());
    client.pipe(backend);

    let buffered: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let waitingForDrain = false;
    function forwardFrames() {
      if (waitingForDrain || client.destroyed) return;
      while (buffered.length >= 5) {
        // Backend packets are a one-byte type, a four-byte length (including
        // that length word), and payload. TCP chunks need not align to packets.
        const length = buffered.readInt32BE(1);
        if (length < 4 || length > 16 * 1024 * 1024) {
          client.destroy();
          backend.destroy();
          return;
        }
        const packetBytes = length + 1;
        if (buffered.length < packetBytes) return;
        const packet = buffered.subarray(0, packetBytes);
        buffered = buffered.subarray(packetBytes);
        if (
          armed &&
          packet[0] === 0x43 &&
          packet.subarray(5).equals(Buffer.from("COMMIT\0"))
        ) {
          // PostgreSQL emitted CommandComplete for the actual COMMIT. Do not
          // forward it (or the following ReadyForQuery) to the driver.
          armed = false;
          droppedCommits++;
          client.destroy();
          backend.destroy();
          return;
        }
        if (!client.write(packet)) {
          waitingForDrain = true;
          backend.pause();
          client.once("drain", () => {
            waitingForDrain = false;
            forwardFrames();
            if (!waitingForDrain) backend.resume();
          });
          return;
        }
      }
    }
    backend.on("data", (chunk: Buffer) => {
      buffered = buffered.length ? Buffer.concat([buffered, chunk]) : chunk;
      forwardFrames();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("postgres_proxy_listener_missing");
  const proxiedUrl = new URL(databaseUrl);
  proxiedUrl.hostname = "127.0.0.1";
  proxiedUrl.port = String(address.port);
  proxiedUrl.searchParams.set("sslmode", "disable");

  return {
    databaseUrl: proxiedUrl.toString(),
    dropNextCommit() {
      armed = true;
    },
    get droppedCommits() {
      return droppedCommits;
    },
    get acceptedConnections() {
      return acceptedConnections;
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
