import fs from "fs/promises";
import log from "./utils/logger.js";
import { readFile, delay, readJson } from "./utils/helper.js";
import banner from "./utils/banner.js";
import LayerEdge from "./utils/socket.js";
import readline from "readline";
import chalk from "chalk";
import { config } from "./config.js";

// Function to read wallets
async function readWallets() {
  try {
    await fs.access("wallets.json");
    const data = await fs.readFile("wallets.json", "utf-8");
    return JSON.parse(data);
  } catch (err) {
    if (err.code === "ENOENT") {
      log.info("No wallets found in wallets.json");
      return [];
    }
    throw err;
  }
}

// Function to ask questions
async function askQuestion(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// Main function
async function run() {
  log.info(chalk.yellow(banner));
  await delay(3);

  const proxies = await readFile("proxy.txt");
  let wallets = await readWallets();
  const localStorage = await readJson("localStorage.json");
  const tasks = await readJson("tasks.json", []);

  let useProxy = await askQuestion("Use Proxy or Not (y/n): ");
  useProxy = useProxy.toLowerCase() === "y";
  if (useProxy && proxies.length < wallets.length) {
    log.error(`Proxy and Wallets count mismatch | Proxy: ${proxies.length} - Wallets: ${wallets.length}`);
    return;
  }

  if (proxies.length === 0) log.warn("No proxies found in proxy.txt - running without proxies");
  if (wallets.length === 0) {
    log.info('No wallets found, create new wallets first with "npm run autoref"');
    return;
  }

  log.info("Starting program with all wallets:", wallets.length);

  while (true) {
    for (let i = 0; i < wallets.length; i++) {
      const wallet = wallets[i];
      const proxy = useProxy ? proxies[i % proxies.length] || null : null;
      const { address, privateKey } = wallet;
      try {
        const socket = new LayerEdge(proxy, privateKey, config.ref_code, localStorage, tasks);
        if (useProxy) {
          log.info(`Checking proxy for wallet ${address}...`);
          const proxyip = await socket.checkProxy();
          if (!proxyip) return;
        }

        log.info(`Claiming node points for wallet ${address}`);
        await socket.checkNodePoints(); // Daily claim part

        if (config.auto_task) {
          log.info(`Checking tasks for wallet ${address}`);
          await socket.handleSubmitProof();
          await socket.handleTasks();
        }
      } catch (error) {
        log.error(`Error processing wallet:`, error.message);
      }
    }
    log.warn(`All wallets processed, waiting 24 hours for the next run...`);
    await delay(24 * 60 * 60); // Wait 24 hours
  }
}

run();
