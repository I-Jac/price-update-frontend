import './style.css'
import { 
    Connection, 
    Keypair, 
    PublicKey, 
    Transaction, 
    TransactionInstruction, 
    AccountMeta, 
    // SystemProgram, // Removed unused import
    ComputeBudgetProgram, 
    Commitment 
} from '@solana/web3.js'
import * as anchor from "@coral-xyz/anchor"

// Import the mock price feed program IDL type and program ID
// import { MockPriceFeed } from './mock_price_feed'
import IDL from './mock_price_feed.json'

// Import the mock price feed data (Vite handles JSON imports)
import MOCK_PRICE_FEEDS_DATA from './mockPriceFeeds.json'

// --- Constants ---
const UPDATE_PRICE_DISCRIMINATOR = Buffer.from([61, 34, 117, 155, 75, 34, 123, 208]);
const PRIORITY_FEE = 10000; // Lower priority fee for local testing maybe
const COMPUTE_UNIT_LIMIT = 200000; // Base compute units

// --- Configuration ---

// Use the same authority key as the faucet for simplicity (payer)
// WARNING: THIS KEY WILL BE PUBLICLY VISIBLE IN YOUR FRONTEND CODE!
const AUTHORITY_SECRET_KEY = new Uint8Array([185,5,173,91,12,63,86,174,120,179,229,194,245,205,82,82,137,52,163,143,21,55,213,6,102,201,68,20,176,119,206,157,229,191,141,162,2,203,2,42,35,182,157,129,223,64,80,91,24,44,18,37,71,35,150,42,170,85,72,61,231,13,227,199])

// Assign imported price feed data
const MOCK_PRICE_FEEDS: { [symbol: string]: string } = MOCK_PRICE_FEEDS_DATA as { [symbol: string]: string }

// Configure your RPC Endpoint
const RPC_ENDPOINT = 'http://127.0.0.1:8900' // Use port 8900

// Hardcoded exponent
const PRICE_EXPONENT = -8

// --- End Configuration ---

// --- Simple Wallet Implementation for Keypair (REMOVED) ---
// class KeypairWallet implements anchor.Wallet { ... }
// ---------------------------------------------

// Globals
let connection: Connection
let authority: Keypair // Use 'authority' naming for clarity, even if just payer
let currentClusterInfo: ClusterInfo // Store cluster info globally
// let provider: anchor.AnchorProvider; // Removed unused global
// let mockPriceFeedProgram: anchor.Program<any>; // Removed unused global

// Interface for cluster information (same as faucet)
interface ClusterInfo {
    explorerClusterParam: string
    solscanClusterParam: string
}

// UI Elements
const priceFeedSelect = document.getElementById('price-feed-select') as HTMLSelectElement
const newPriceInput = document.getElementById('new-price') as HTMLInputElement
const updatePriceButton = document.getElementById('update-price-button') as HTMLButtonElement
const statusMessageEl = document.getElementById('status-message') as HTMLParagraphElement
const txSignatureEl = document.getElementById('tx-signature') as HTMLParagraphElement
const feedAccountLinkArea = document.getElementById('feed-account-link-area') as HTMLDivElement

/**
 * Update the status display and clear links.
 */
function updateStatus(message: string, isError = false) {
    console.log(message)
    if (statusMessageEl) {
        statusMessageEl.textContent = `Status: ${message}`
        statusMessageEl.className = isError ? 'error' : ''
    }
    // Clear links when status updates
    if (txSignatureEl) txSignatureEl.innerHTML = ''
    if (feedAccountLinkArea) feedAccountLinkArea.innerHTML = ''
}

/**
 * Determines cluster parameters for explorer links based on RPC endpoint.
 */
function getClusterInfo(): ClusterInfo {
    if (RPC_ENDPOINT.includes('devnet')) {
        return { explorerClusterParam: 'devnet', solscanClusterParam: 'devnet' }
    }
    if (RPC_ENDPOINT.includes('testnet')) {
        return { explorerClusterParam: 'testnet', solscanClusterParam: 'testnet' }
    }
    if (RPC_ENDPOINT.includes('mainnet')) {
        return { explorerClusterParam: 'mainnet-beta', solscanClusterParam: 'mainnet-beta' }
    }
    // Default to custom cluster
    const customUrlParam = `custom&customUrl=${encodeURIComponent(RPC_ENDPOINT)}`
    return { explorerClusterParam: customUrlParam, solscanClusterParam: customUrlParam }
}

/**
 * Generates a Solscan URL.
 */
function generateSolscanUrl(type: 'tx' | 'account', id: string, clusterInfo: ClusterInfo): string {
    return `https://solscan.io/${type}/${id}?cluster=${clusterInfo.solscanClusterParam}`
}

/**
 * Update status with transaction signature links.
 */
function showTransactionLinks(signature: string) {
    if (!currentClusterInfo) {
        currentClusterInfo = getClusterInfo() // Ensure cluster info is available
    }
    if (!txSignatureEl) return

    const solscanUrl = generateSolscanUrl('tx', signature, currentClusterInfo)
    txSignatureEl.innerHTML = `Transaction: <a href="${solscanUrl}" target="_blank" title="View on Solscan">${signature}</a>`
}

/**
 * Show link to the price feed account.
 */
function showPriceFeedAccountLink(address: string) {
    if (!feedAccountLinkArea || !currentClusterInfo) return

    const solscanUrl = generateSolscanUrl('account', address, currentClusterInfo)
    const shortAddress = `${address.substring(0, 4)}...${address.substring(address.length - 4)}`
    feedAccountLinkArea.innerHTML = `Price Feed Account: <a href="${solscanUrl}" target="_blank" title="View Price Feed Account on Solscan">${shortAddress}</a>`
}

/**
 * Populate the mock price feed dropdown.
 */
function populatePriceFeedDropdown() {
    if (!priceFeedSelect) return
    priceFeedSelect.innerHTML = '<option value="">-- Select Feed --</option>' // Clear existing

    if (Object.keys(MOCK_PRICE_FEEDS).length === 0) {
        console.warn('MOCK_PRICE_FEEDS not populated yet for dropdown.')
        updateStatus('Error: Price feed list not loaded. Did you run `anchor test` in mockPriceFeed?', true)
        return
    }

    const sortedSymbols = Object.keys(MOCK_PRICE_FEEDS).sort()

    for (const symbol of sortedSymbols) {
        const option = document.createElement('option')
        option.value = symbol
        option.textContent = symbol
        priceFeedSelect.appendChild(option)
    }
}

// --- Utility Functions ---

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Builds the instruction data buffer for the `update_price` instruction.
 */
function buildUpdatePriceInstructionData(newPrice: anchor.BN, newExpo: number): Buffer {
    // Allocate buffer: 8 bytes (discriminator) + 8 bytes (i64 price) + 4 bytes (i32 expo)
    const buffer = Buffer.alloc(8 + 8 + 4);
    
    // Write discriminator
    UPDATE_PRICE_DISCRIMINATOR.copy(buffer, 0);
    
    // Write price (i64, little-endian)
    // BN.toArrayLike requires Buffer type, 'le' for little-endian, and byte length
    const priceBuffer = newPrice.toArrayLike(Buffer, 'le', 8);
    priceBuffer.copy(buffer, 8); 

    // Write exponent (i32, little-endian)
    const expoBuffer = Buffer.alloc(4);
    expoBuffer.writeInt32LE(newExpo, 0);
    expoBuffer.copy(buffer, 8 + 8);

    return buffer;
}

/**
 * Sends and confirms a transaction with retry logic.
 */
async function sendAndConfirmTransaction(
  connection: Connection, 
  transaction: Transaction, 
  payer: Keypair, 
  maxRetries: number = 3, 
  retryDelayMs: number = 2000, 
  commitment: Commitment = "confirmed"
): Promise<string> {
  let lastError: any = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
        // Get latest blockhash before each attempt
        const latestBlockhash = await connection.getLatestBlockhash(commitment);
        transaction.recentBlockhash = latestBlockhash.blockhash;
        transaction.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight; // Set this too
        transaction.feePayer = payer.publicKey;
        
        // Sign transaction (only needs payer signature)
        transaction.sign(payer);

        const rawTransaction = transaction.serialize();
        const options = {
            skipPreflight: true, 
            commitment: commitment,
            maxRetries: 0 // Handle retries manually
        };

        // Send the raw transaction
        const txSignature = await connection.sendRawTransaction(rawTransaction, options);
        console.log(`    Transaction sent (Attempt ${i + 1}/${maxRetries}): ${txSignature}`);

        // Confirm the transaction
        const confirmation = await connection.confirmTransaction({
            signature: txSignature,
            blockhash: transaction.recentBlockhash,
            lastValidBlockHeight: transaction.lastValidBlockHeight
        }, commitment);

        if (confirmation.value.err) {
            console.error(`    Transaction confirmation failed (Attempt ${i + 1}/${maxRetries}):`, confirmation.value.err);
            throw new Error(`Transaction failed confirmation: ${JSON.stringify(confirmation.value.err)}`);
        }

        console.log(`    Transaction confirmed successfully: ${txSignature}`);
        return txSignature; // Success

    } catch (err: any) {
        lastError = err;
        const errorMessage = err.message || "";

        // Check for common transient errors
        if (
            errorMessage.includes("Blockhash not found") ||
            errorMessage.includes("block height exceeded") ||
            errorMessage.includes("TransactionExpiredTimeoutError") ||
            errorMessage.includes("timed out") ||
            errorMessage.includes("Node is behind") ||
            errorMessage.includes("Network request failed") || 
            errorMessage.includes("failed confirmation")
        ) {
            if (i < maxRetries - 1) {
                console.warn(`    Transaction failed (Attempt ${i + 1}/${maxRetries}): ${errorMessage}. Retrying in ${retryDelayMs}ms...`);
                await sleep(retryDelayMs);
            } else {
                console.error(`    Transaction failed after ${maxRetries} attempts.`);
            }
        } else {
            console.error("    Non-retryable transaction error:", err);
            throw err; 
        }
    }
  }
  console.error("Send and confirm failed after all retries.", lastError);
  throw lastError;
}

// --- End Utility Functions ---

/**
 * Handle the update price button click - MANUAL TX Version.
 */
async function handleUpdatePrice() {
    // Remove provider check, keep others
    if (!connection || !authority || !priceFeedSelect || !newPriceInput || !updatePriceButton) { 
        updateStatus('Initialization error. Check console.', true);
        return;
    }

    const selectedSymbol = priceFeedSelect.value;
    const newPriceDisplayStr = newPriceInput.value.trim(); // User enters display value

    if (!selectedSymbol) {
        updateStatus('Please select a price feed symbol.', true);
        return;
    }

    if (!newPriceDisplayStr) {
        updateStatus('Please enter a new price.', true);
        return;
    }

    let newPriceRaw: anchor.BN;
    const hardcodedExponent = PRICE_EXPONENT; 

    try {
        // 1. Validate user input is a valid number string (can include decimals for display value)
        if (isNaN(parseFloat(newPriceDisplayStr))) { 
            throw new Error("Invalid number format for price.");
        }

        // 2. Use BigInt for scaling to avoid JS number limits
        // Split the display string into integer and fractional parts
        const parts = newPriceDisplayStr.split('.');
        const integerPart = parts[0];
        const fractionalPart = parts[1] || '';

        // Calculate how many zeros to pad/remove based on exponent
        const numZerosToAdd = Math.abs(hardcodedExponent);
        
        // Ensure fractional part doesn't exceed the required precision
        if (fractionalPart.length > numZerosToAdd) {
            throw new Error(`Input precision (${fractionalPart.length} decimals) exceeds exponent precision (${numZerosToAdd}).`);
        }

        // Create the raw value string by concatenating integer part and padded fractional part
        const paddedFractional = fractionalPart.padEnd(numZerosToAdd, '0');
        const rawValueString = integerPart + paddedFractional;

        // 3. Create BN from the final raw value string
        newPriceRaw = new anchor.BN(rawValueString);

    } catch (error: any) {
        updateStatus(`Invalid price input/calculation: ${error.message || 'Error processing price.'}`, true);
        console.error(error);
        return;
    }

    const mockFeedAddressStr = MOCK_PRICE_FEEDS[selectedSymbol];
    if (!mockFeedAddressStr) {
        updateStatus(`Mock feed address not found for ${selectedSymbol}. Check mockPriceFeeds.json.`, true);
        return;
    }

    const mockFeedPublicKey = new PublicKey(mockFeedAddressStr);
    const programId = new PublicKey(IDL.address); // Get program ID from IDL

    updatePriceButton.disabled = true;
    updateStatus(`Building transaction for ${selectedSymbol} to ${newPriceDisplayStr} (raw: ${newPriceRaw.toString()}, exponent: ${hardcodedExponent})...`);

    try {
        // 1. Build Instruction Data
        const instructionData = buildUpdatePriceInstructionData(newPriceRaw, hardcodedExponent);

        // 2. Define Accounts
        const accounts: AccountMeta[] = [
            { pubkey: mockFeedPublicKey, isSigner: false, isWritable: true },
        ];

        // 3. Create Instruction
        const instruction = new TransactionInstruction({
            keys: accounts,
            programId: programId,
            data: instructionData,
        });

        // 4. Create Transaction
        const transaction = new Transaction()
            .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE }))
            .add(ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }))
            .add(instruction);

        updateStatus(`Sending transaction for ${selectedSymbol}...`);

        // 5. Send and Confirm Transaction
        const signature = await sendAndConfirmTransaction(
            connection, 
            transaction, 
            authority // Payer keypair
        );

        updateStatus(`Successfully updated price for ${selectedSymbol}!`);
        showTransactionLinks(signature);
        showPriceFeedAccountLink(mockFeedPublicKey.toBase58());

    } catch (error: any) {
        updateStatus(`Update failed: ${error.message || error}`, true);
        console.error('Price update error:', error);
        // Simulation logs are not easily available in this manual method
    } finally {
        updatePriceButton.disabled = false;
    }
}

/**
 * Initialize the script.
 */
async function initialize() {
    updateStatus('Initializing...');

    // Validate embedded key
    if (AUTHORITY_SECRET_KEY.length !== 64) {
        updateStatus('ERROR: Invalid AUTHORITY_SECRET_KEY length. Paste the 64-byte array.', true);
        return;
    }

    try {
        // Cluster info, authority, connection setup remains the same
        currentClusterInfo = getClusterInfo();
        console.log('Cluster Info:', currentClusterInfo);
        authority = Keypair.fromSecretKey(AUTHORITY_SECRET_KEY);
        console.log('Authority/Payer Key:', authority.publicKey.toBase58());
        connection = new Connection(RPC_ENDPOINT, 'confirmed');
        console.log('Connected to:', RPC_ENDPOINT);
        await connection.getVersion(); 
        console.log('Connection successful.');

        // --- Removed Anchor Provider/Program setup ---
        // const wallet = new KeypairWallet(authority); 
        // provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
        // anchor.setProvider(provider);
        // const programId = new PublicKey(IDL.address);
        // console.log(`Using Program ID: ${programId.toBase58()}`);
        // console.log("Attempting to load program with imported IDL...");
        // console.log("IDL Object:", JSON.stringify(IDL, null, 2));
        // mockPriceFeedProgram = new anchor.Program(IDL, programId, provider);
        // console.log(`Mock Price Feed Program loaded successfully.`);
        // --- End Anchor Setup Removal ---
        
        // Check if feed addresses are loaded (still needed)
        if (Object.keys(MOCK_PRICE_FEEDS).length === 0) {
            throw new Error('Mock price feed addresses data is empty after import. Run `anchor test` in mockPriceFeed project.');
        }
        console.log('Successfully loaded MOCK_PRICE_FEEDS via import:', MOCK_PRICE_FEEDS);

        // Populate the dropdown
        populatePriceFeedDropdown();

        // Add listener for the update button
        if (updatePriceButton) {
            updatePriceButton.addEventListener('click', handleUpdatePrice);
        }

        updateStatus('Ready. Select feed and enter new price.');

    } catch (error: any) {
        updateStatus(`Initialization failed: ${error.message || error}`, true);
        console.error('Initialization error:', error);
    }
}

// --- Run Initialization ---
document.addEventListener('DOMContentLoaded', initialize);
