const ngrok = require("ngrok");
const envFile = require("envfile");
const path = require("path");
const fs = require("fs");
const _ = require("lodash");

/**
 * Creates public tunnels for provided ports on localhost. Also, writes tunnels url to .env file and deletes them after session is over.
 */
class ServerlessTunnel {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.log = serverless.cli.log.bind(serverless.cli);
    this.slsOptions = options;
    this.reconnectTried = false;
    this.noEnvFile = true;

    this.commands = {
      tunnel: {
        lifecycleEvents: ["init"],
      },
    };

    // Run tunnels after serverless-offline
    this.hooks = {
      "tunnel:init": async () => {
        this.runServer(true);
      },
      "before:offline:start:init": async () => {
        this.runServer();
      },
      "before:offline:start:end": async () => {
        this.closeServer();
      },
    };
  }

  async runTunnel({ port, envProp, ws, path, ngrokOptions }) {
    try {
      const url = await ngrok.connect({
        addr: port,
        proto: "http",
        region: "eu",
        ...(ngrokOptions || {}),
        onStatusChange: (status) => {
          if (status === "closed") {
            this.onTunnelClose();
          }
        },
      });

      this.onConnect(url, envProp, ws, path);
    } catch (err) {
      this.log(`Unable to create tunnel: ${err.message}`);
      this.errorHandler(err);
    }
  }

  onConnect(url, envProp, ws, path) {
    const tunnel = ws ? url.replace("http", "ws") : url;
    if (envProp) {
      this.envContent[envProp] = `${tunnel}${path || ""}`;
      this.log(`${envProp} available at: ${this.envContent[envProp]}`);
    } else {
      this.log(`Tunnel created at ${tunnel}${path || ""}`);
    }
    this.writeToEnv();
  }

  errorHandler(e) {
    this.log(
      `Tunnels error: ${e.message}. Trying to reconnect in 5 seconds...`
    );
    this.tryReconnect();
  }

  onTunnelClose() {
    this.log("Tunnel disconnected.");
  }

  runServer(selfInit) {
    this.options = _.get(this.serverless, "service.custom.ngrokTunnel", {});

    if (this.options.envPath) {
      this.noEnvFile = false;
      this.envPath = path.resolve(process.cwd(), this.options.envPath);

      try {
        this.envContent = envFile.parseFileSync(this.envPath);
      } catch (e) {
        this.envContent = {};
        this.noEnvFile = true;
      }
    }
    if (this.slsOptions.tunnel === "true" || selfInit) {
      if (this.options.tunnels && this.options.tunnels.length) {
        this.log("Starting tunnels...");
        this.options.tunnels.forEach((opt) => this.runTunnel(opt));
      } else {
        this.log("Tunnels are not configured. Skipping...");
      }
    }
  }

  closeServer() {
    this.log("Stopping tunnels...");
    this.stopTunnel();
  }

  stopTunnel() {
    ngrok.kill();
    if (!this.noEnvFile) {
      (this.options.tunnels || []).forEach(({ envProp }) => {
        delete this.envContent[envProp];
      });
      this.writeToEnv();
    }
  }

  tryReconnect() {
    if (!this.reconnectTried) {
      setTimeout(() => {
        (this.options.tunnels || []).forEach((opt) => this.runTunnel(opt));
      }, 5000);
      this.reconnectTried = true;
    }
  }

  writeToEnv() {
    if (!this.noEnvFile) {
      fs.writeFileSync(this.envPath, envFile.stringifySync(this.envContent));
    }
  }
}

module.exports = ServerlessTunnel;
