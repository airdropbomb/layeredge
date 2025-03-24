import axios from "axios";
import chalk from "chalk";
import { ethers, Wallet } from "ethers";
import log from "./logger.js";
import { newAgent, saveJson } from "./helper.js";
import { ABI } from "./ABI.js";
import { config } from "../config.js";
import { solveCaptcha } from "./captcha.js";

const delay = async (s) => await new Promise((resolves) => setTimeout(resolves, s * 1000));
class LayerEdgeConnection {
  constructor(proxy = null, privateKey = null, refCode = "amR1ncRj", localStorage, tasks) {
    this.refCode = refCode;
    this.proxyIP = null;
    this.proxy = proxy;
    this.privateKey = privateKey;
    this.localStorage = localStorage;
    this.tasks = tasks;
    this.axiosConfig = {
      ...(this.proxy && { httpsAgent: newAgent(this.proxy) }),
      timeout: 60000,
    };

    this.wallet = privateKey ? new Wallet(privateKey) : Wallet.createRandom();
  }

  getWallet() {
    return this.wallet;
  }

  async makeRequest(method, url, config = {}, retries = 15) {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await axios({
          method,
          url,
          headers: {
            Accept: "*/*",
            "Accept-Encoding": "gzip, deflate, br",
            "Accept-Language": "en-US,en;q=0.9",
            "Content-Type": "application/json",
            Origin: "https://dashboard.layeredge.io",
            Referer: "https://dashboard.layeredge.io/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          },
          ...this.axiosConfig,
          ...config,
        });
        return response;
      } catch (error) {
        if (error?.response?.status === 404 || error?.status === 404) {
          log.error(`Layer Edge connection failed wallet not registered yet...`);
          return 404;
        }
        if (error?.response?.status === 400) {
          log.error(`Invalid param for request ${url}...`);
          return 400;
        } else if (error.response?.status === 409) {
          return error.response.data;
        } else if (error.response?.status === 429) {
          log.error(chalk.red(`Layer Edge rate limit exceeded...`));
          await delay(60);
          continue;
        } else if (i === retries - 1) {
          log.error(`Max retries reached - Request failed:`, error.message);
          if (this.proxy) {
            log.error(`Failed proxy: ${this.proxy}`, error.message);
          }
          return null;
        }
        process.stdout.write(chalk.yellow(`Request failed: ${error.message} => Retrying... (${i + 1}/${retries})\r`));
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    return null;
  }

  async checkInvite() {
    const inviteData = {
      invite_code: this.refCode,
    };

    const response = await this.makeRequest("post", `${config.baseURL}/referral/verify-referral-code`, { data: inviteData });

    if (response && response.data && response.data.data.valid === true) {
      log.info("Invite Code Valid", response.data);
      return true;
    } else {
      log.error("Failed to check invite");
      return false;
    }
  }

  async registerWallet() {
    const registerData = {
      walletAddress: this.wallet.address,
    };

    const response = await this.makeRequest("post", `${config.baseURL}/referral/register-wallet/${this.refCode}`, { data: registerData });

    if (response && response.data) {
      log.info("Wallet successfully registered", response.data);
      return true;
    } else {
      log.error("Failed To Register wallets", "error");
      return false;
    }
  }

  async verifyCaptcha() {
    const token = await solveCaptcha();
    if (!token) {
      log.error("Failed to solve captcha");
      return false;
    }
    const response = await this.makeRequest("post", `https://dashboard.layeredge.io/api/verify-captcha`, { token });
    if (response && response.data) {
      log.info("Verify captcha successfully", response.data);
      return true;
    } else {
      log.error(`Failed To Register wallets`, "error");
      return false;
    }
  }

  async connectNode() {
    const timestamp = Date.now();
    const message = `Node activation request for ${this.wallet.address} at ${timestamp}`;
    const sign = await this.wallet.signMessage(message);

    const dataSign = {
      sign: sign,
      timestamp: timestamp,
    };

    const response = await this.makeRequest("post", `${config.baseURL}/light-node/node-action/${this.wallet.address}/start`, { data: dataSign });

    if (response && response.data && response.data.message === "node action executed successfully") {
      log.info(`[${this.wallet.address}] Connected Node Successfully`, response.data);
      return true;
    } else {
      log.warn(`[${this.wallet.address}] Failed to connect Node`);
      return false;
    }
  }

  generateRandomNumber(length = 19) {
    if (length < 1) return "";

    let result = "";
    const digits = "0123456789";

    // Choose the first digit so it’s not 0
    result += Math.floor(Math.random() * 9) + 1; // 1-9

    // Choose the remaining digits
    for (let i = 1; i < length; i++) {
      result += digits.charAt(Math.floor(Math.random() * digits.length));
    }

    return result;
  }

  async connectTwitter() {
    const timestamp = Date.now();
    const message = `I am verifying my Twitter authentication for ${this.wallet.address} at ${timestamp}`;
    const sign = await this.wallet.signMessage(message);
    const id = this.generateRandomNumber();
    const dataSign = {
      walletAddress: this.wallet.address,
      sign: sign,
      timestamp: timestamp,
      twitterId: id,
    };

    const response = await this.makeRequest("post", `${config.baseURL}/task/connect-twitter`, { data: dataSign });

    if (response && response.data && response.data.message.includes("verified")) {
      log.info(`[${this.wallet.address}] Connected twitter Successfully`, response.data);
      return true;
    } else {
      log.warn(`[${this.wallet.address}] Failed to connect Node`, response);
      return false;
    }
  }

  async getProofStatus(task) {
    const response = await this.makeRequest("get", `${config.baseURL}/card/proof-status/${this.wallet.address}`);
    if (response && response.data) {
      const submited = response.data.data.hasSubmitted;
      const isCardGenerated = response.data.data.isCardGenerated;
      if (submited === false) {
        return await this.submitProof();
      }
      if (!task) return false;

      if (isCardGenerated === false) {
        const res = await this.generateCard();
        if (res) return await this.doTask(task);
        return false;
      } else if (submited && isCardGenerated) {
        return await this.doTask(task);
      }
      return true;
    } else {
      return false;
    }
  }

  async submitProof() {
    const timestamp = new Date().toISOString();
    const message = `I am submitting a proof for LayerEdge at ${timestamp}`;
    const sign = await this.wallet.signMessage(message);

    const dataSign = {
      message: message,
      signature: sign,
      walletAddress: this.wallet.address,
      proof: `Hi, my wallet address ${this.wallet.address}. I'm verified submit proof`,
    };

    const response = await this.makeRequest("post", `${config.baseURL}/card/submit-proof`, { data: dataSign });
    if (response && response.data) {
      log.info(`[${this.wallet.address}] Submit Proof Success: `, response.data);
      return false;
    } else {
      log.warn(`[${this.wallet.address}] Failed to submit proof`);
      return false;
    }
  }

  async generateCard() {
    const response = await this.makeRequest("post", `${config.baseURL}/card/shareable-card`, {
      data: {
        walletAddress: this.wallet.address,
      },
    });
    if (response && response.data) {
      log.info(`[${this.wallet.address}] Generate card success: `, response.data);
      return true;
    } else {
      log.error(`[${this.wallet.address}] Failed to generate card`);
      return false;
    }
  }

  async handleSubmitProof() {
    return await this.getProofStatus();
  }

  async handleTasks() {
    if (!config.auto_task) return false;
    for (const task of this.tasks) {
      await delay(1);
      const tasksCompleted = this.localStorage[this.wallet.address]?.tasks || [];
      if (tasksCompleted.includes(task.id)) {
        continue;
      }
      if (task.id === "proof-submission") {
        return await this.getProofStatus(task);
      } else {
        return this.doTask(task);
      }
    }
  }

  async doTask(task) {
    const timestamp = Date.now();
    const message = `${task.message} ${this.wallet.address} at ${timestamp}`;
    const sign = await this.wallet.signMessage(message);
    const dataSign = {
      sign: sign,
      timestamp: timestamp,
      walletAddress: this.wallet.address,
    };
    const response = await this.makeRequest("post", `${config.baseURL}/task/${task.id}`, { data: dataSign });
    if (response && response.data && response.data.message?.includes("successfully")) {
      log.info(`Completed Task ${task.title} Successfully`, response.data);
      await saveJson(this.localStorage, this.wallet.address, task.id, "localStorage.json");
      return task.id;
    } else {
      log.warn(`[${this.wallet.address}] Failed to Completed Task ${task.title}`, response);
      if (response == 404 && task.id == "nft-verification/1") {
        const resMint = await this.handleMintNFT();
        if (resMint) {
          await this.doTask(task);
        }
      } else if (response.message?.includes("already completed")) {
        await saveJson(this.localStorage, this.wallet.address, task.id, "localStorage.json");
        return task.id;
      }
      return false;
    }
  }

  async handleMintNFT() {
    const provider = new ethers.JsonRpcProvider(config.rpc);
    const wallet = new ethers.Wallet(this.privateKey, provider);
    const contractAddress = "0xb06C68C8f9DE60107eAbda0D7567743967113360";
    const contractABI = ABI;
    const nftContract = new ethers.Contract(contractAddress, contractABI, wallet);
    const allowlistProof = [
      [], // proof (empty array if no proof)
      0, // quantityLimitPerWallet
      ethers.constants.MaxUint256, // pricePerToken (maximum value)
      ethers.constants.AddressZero, // currency address
    ];
    try {
      const tx = await nftContract.claim(
        wallet.address, // receiver
        1, // quantity
        ethers.AddressZero, // currency (if minting is free)
        0, // pricePerToken value is 0
        allowlistProof, // allowlistProof
        "0x" // data
      );

      log.info("Minting NFT... Transaction Hash:", tx.hash);
      // Wait for transaction confirmation
      await tx.wait();
      log.success(`NFT minted successfully! Hash: https://basescan.org/tx/${tx.hash}`);
      return true;
    } catch (error) {
      console.error("Error minting NFT:", error.message);
      return false;
    }
  }

  async stopNode() {
    const timestamp = Date.now();
    const message = `Node deactivation request for ${this.wallet.address} at ${timestamp}`;
    const sign = await this.wallet.signMessage(message);

    const dataSign = {
      sign: sign,
      timestamp: timestamp,
    };

    const response = await this.makeRequest("post", `${config.baseURL}/light-node/node-action/${this.wallet.address}/stop`, { data: dataSign });

    if (response && response.data) {
      log.info(`[${this.wallet.address}] Stop and Claim Points Result:`, response.data);
      return true;
    } else {
      log.warn(`[${this.wallet.address}] Failed to Stopping Node and claiming points`);
      return false;
    }
  }

  async checkNodeStatus() {
    const response = await this.makeRequest("get", `${config.baseURL}/light-node/node-status/${this.wallet.address}`);

    if (response === 404) {
      log.info(`[${this.wallet.address}] Node not found in this wallet, trying to regitering wallet...`);
      await this.registerWallet();
      return false;
    }

    if (response && response.data && response.data.data.startTimestamp !== null) {
      log.info(`[${this.wallet.address}] Node Status Running`, response.data);
      return true;
    } else {
      log.warn(`[${this.wallet.address}] Node not running trying to start node...`);
    }
    return false;
  }

  async checkNodePoints() {
    const response = await this.makeRequest("get", `${config.baseURL}/referral/wallet-details/${this.wallet.address}`);
    if (response && response.data) {
      const isTwitterVerified = response.data.data.isTwitterVerified;
      log.info(`[${this.wallet.address}] Total Points:`, response.data.data?.nodePoints || 0);
      const lasCheckin = response.data.data?.lastClaimed;
      const isNewDate = new Date() - new Date(lasCheckin) > 24 * 60 * 60 * 1000;
      if (isNewDate || !lasCheckin) {
        await this.checkIn();
      }
      if (!isTwitterVerified && config.auto_connect_twitter) {
        log.info(`[${this.wallet.address}] Trying connect twitter...`);
        await this.connectTwitter();
      }
      return true;
    } else {
      log.error(`[${this.wallet.address}] Failed to check Total Points..`);
      return false;
    }
  }

  async checkIn() {
    const timestamp = Date.now();
    const message = `I am claiming my daily node point for ${this.wallet.address} at ${timestamp}`;
    const sign = await this.wallet.signMessage(message);

    const dataSign = {
      sign: sign,
      timestamp: timestamp,
      walletAddress: this.wallet.address,
    };
    const response = await this.makeRequest("post", `${config.baseURL}/light-node/claim-node-points`, { data: dataSign });
    if (response && response.data) {
      log.info(`$[${this.wallet.address}] Checkin success:`, response.data);
      return true;
    } else {
      log.error(`[${this.wallet.address}] Failed to check in..`);
      return false;
    }
  }

  async checkProxy() {
    try {
      const response = await axios.get("https://api.ipify.org?format=json", { httpsAgent: newAgent(this.proxy) });
      if (response.status === 200) {
        this.proxyIP = response.data.ip;
        return true;
      } else {
        log.error(`[${this.wallet.address}] Cannot check proxy IP. Status code: ${response.status}`);
        return false;
      }
    } catch (error) {
      log.error(`[${this.wallet.address}] Error checking proxy IP: ${error.message}`);
      return false;
    }
  }
}

export default LayerEdgeConnection;
