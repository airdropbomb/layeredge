import fs from "fs/promises";
import log from "./utils/logger.js";
import { readFile, delay, readJson } from "./utils/helper.js";
import banner from "./utils/banner.js";
import LayerEdge from "./utils/socket.js";
import readline from "readline";
import chalk from "chalk";
import { config } from "./config.js";

// ဝေါလတ်တွေကို ဖတ်တဲ့ ဖန်ရှင်
async function readWallets() {
  try {
    await fs.access("wallets.json");
    const data = await fs.readFile("wallets.json", "utf-8");
    return JSON.parse(data);
  } catch (err) {
    if (err.code === "ENOENT") {
      log.info("wallets.json ထဲမှာ ဝေါလတ်မရှိဘူး");
      return [];
    }
    throw err;
  }
}

// မေးခွန်းမေးတဲ့ ဖန်ရှင်
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

// ပင်မလုပ်ဆောင်မှု
async function run() {
  log.info(chalk.yellow(banner));
  await delay(3);

  const proxies = await readFile("proxy.txt");
  let wallets = await readWallets();
  const localStorage = await readJson("localStorage.json");
  const tasks = await readJson("tasks.json", []);

  let useProxy = await askQuestion("Proxy သုံးမလား မသုံးဘူးလား (y/n): ");
  useProxy = useProxy.toLowerCase() === "y";
  if (useProxy && proxies.length < wallets.length) {
    log.error(`Proxy နဲ့ ဝေါလတ်အရေအတွက် မညီဘူး | Proxy: ${proxies.length} - Wallets: ${wallets.length}`);
    return;
  }

  if (proxies.length === 0) log.warn("proxy.txt ထဲမှာ proxy မရှိဘူး - proxy မသုံးပဲ လုပ်မယ်");
  if (wallets.length === 0) {
    log.info('ဝေါလတ်မရှိဘူး၊ အရင် ဝေါလတ်အသစ်လုပ်ပါ "npm run autoref"');
    return;
  }

  log.info("ဝေါလတ်အားလုံးနဲ့ ပရိုဂရမ်စတင်မယ်:", wallets.length);

  while (true) {
    for (let i = 0; i < wallets.length; i++) {
      const wallet = wallets[i];
      const proxy = useProxy ? proxies[i % proxies.length] || null : null;
      const { address, privateKey } = wallet;
      try {
        const socket = new LayerEdge(proxy, privateKey, config.ref_code, localStorage, tasks);
        if (useProxy) {
          log.info(`ဝေါလတ် ${address} အတွက် proxy စစ်မယ်...`);
          const proxyip = await socket.checkProxy();
          if (!proxyip) return;
        }

        log.info(`ဝေါလတ် ${address} အတွက် နို့ဒ်ပွိုင့်တွေ ကလိမ်းလုပ်မယ်`);
        await socket.checkNodePoints(); // daily claim လုပ်တဲ့ အပိုင်း

        if (config.auto_task) {
          log.info(`ဝေါလတ် ${address} အတွက် တက်စ်တွေ စစ်မယ်`);
          await socket.handleSubmitProof();
          await socket.handleTasks();
        }
      } catch (error) {
        log.error(`ဝေါလတ်ကို လုပ်ဆောင်မှု မအောင်မြင်ဘူး:`, error.message);
      }
    }
    log.warn(`ဝေါလတ်အားလုံး ပြီးသွားပြီ၊ ၂၀ နာရီစောင့်ပြီး နောက်တစ်ခေါက်လုပ်မယ်...`);
    await delay(20 * 60 * 60); // ၂၀ နာရီ စောင့်မယ်
  }
}

run();
