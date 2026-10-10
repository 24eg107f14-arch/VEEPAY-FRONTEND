import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ethers } from 'ethers';
import { Html5Qrcode } from 'html5-qrcode';
import { QRCodeSVG } from 'qrcode.react';
import { BiometricAuth, AndroidBiometryStrength } from '@aparajita/capacitor-biometric-auth';
import { NETWORKS, USDT_ABI } from './networks';
import './history.css';

const STORAGE_KEY = 'bsc-vault-keystore-v1';
const ACCOUNTS_KEY = 'veeru-walletpro-accounts-v1';
const BSCSCAN_KEY = 'veeru-walletpro-bscscan-key-v1';
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const format = (v, decimals = 18) => Number(ethers.formatUnits(v, decimals)).toLocaleString(undefined, { maximumFractionDigits: 6 });
function loadAccounts() {
  try {
    const saved = JSON.parse(localStorage.getItem(ACCOUNTS_KEY));
    if (Array.isArray(saved) && saved.length) return saved;
  } catch {}
  const legacy = localStorage.getItem(STORAGE_KEY);
  return legacy ? [{ id: 'legacy-account', label: 'Account 1', address: '', keystore: legacy }] : [];
}

export default function App() {
  const [networkKey, setNetworkKey] = useState('testnet');
  const [accounts, setAccounts] = useState(loadAccounts);
  const [activeAccountId, setActiveAccountId] = useState(() => loadAccounts()[0]?.id || null);
  const [keystore, setKeystore] = useState(() => loadAccounts()[0]?.keystore || localStorage.getItem(STORAGE_KEY));
  const [wallet, setWallet] = useState(null);
  const [password, setPassword] = useState('');
  const [seed, setSeed] = useState('');
  const [derivationIndex, setDerivationIndex] = useState('0');
  const [mode, setMode] = useState('welcome');
  const [balances, setBalances] = useState({ bnb: '—', usdt: '—' });
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [bscscanKey, setBscscanKey] = useState(() => localStorage.getItem(BSCSCAN_KEY) || '');
  const [apiSettingsOpen, setApiSettingsOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [asset, setAsset] = useState('BNB');
  const [sending, setSending] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [selectedTx, setSelectedTx] = useState(null);
  const [pendingTx, setPendingTx] = useState(null);
  const [revealPhrase, setRevealPhrase] = useState(false);
  const [sendAuthorization, setSendAuthorization] = useState(false);
  const [authorizationPassword, setAuthorizationPassword] = useState('');
  const network = NETWORKS[networkKey];
  const provider = useMemo(() => new ethers.JsonRpcProvider(network.rpc, network.chainId), [network]);

  useEffect(() => { if (wallet) refresh(); }, [wallet, provider]);

  function persistAccounts(next) { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(next)); setAccounts(next); }
  function addAccount(address, encrypted) {
    const account = { id: crypto.randomUUID(), label: `Account ${accounts.length + 1}`, address, keystore: encrypted };
    const next = [...accounts, account]; persistAccounts(next); setActiveAccountId(account.id); setKeystore(encrypted); localStorage.removeItem(STORAGE_KEY);
  }
  function updateActiveAddress(address) {
    const next = accounts.map(account => account.id === activeAccountId ? { ...account, address } : account);
    persistAccounts(next);
  }
  function switchAccount(id) {
    const account = accounts.find(item => item.id === id); if (!account) return;
    setActiveAccountId(id); setKeystore(account.keystore); setWallet(null); setMode('unlock'); setNotice('Unlock the selected account.');
  }

  async function createWallet() {
    if (password.length < 10) return setNotice('Use a password of at least 10 characters.');
    const fresh = ethers.Wallet.createRandom();
    const encrypted = await fresh.encrypt(password);
    addAccount(fresh.address, encrypted); setWallet(fresh); setSeed(fresh.mnemonic.phrase); setMode('backup'); setPassword('');
  }
  async function importWallet() {
    if (password.length < 10) return setNotice('Use a password of at least 10 characters.');
    try {
      const phrase = seed.trim().toLowerCase().replace(/\s+/g, ' ');
      const index = Number(derivationIndex);
      if (!Number.isInteger(index) || index < 0 || index > 99) return setNotice('Account number must be a whole number from 0 to 99.');
      const imported = ethers.HDNodeWallet.fromPhrase(phrase, undefined, `m/44'/60'/0'/0/${index}`); const encrypted = await imported.encrypt(password);
      addAccount(imported.address, encrypted); setWallet(imported); setSeed(''); setPassword(''); setMode('home'); setNotice('Wallet imported and encrypted on this device.');
    } catch { setNotice('That recovery phrase is not valid.'); }
  }
  async function unlock() {
    try { const unlocked = await ethers.Wallet.fromEncryptedJson(keystore, password); setWallet(unlocked); updateActiveAddress(unlocked.address); setPassword(''); setMode('home'); }
    catch { setNotice('Incorrect password.'); }
  }
  async function refresh() {
    try {
      const bnb = await provider.getBalance(wallet.address); let usdt = 'Not configured';
      if (network.usdt) { const c = new ethers.Contract(network.usdt, USDT_ABI, provider); usdt = format(await c.balanceOf(wallet.address), 18); }
      setBalances({ bnb: format(bnb), usdt });
    } catch { setBalances({ bnb: 'Unavailable', usdt: 'Unavailable' }); }
    loadHistory();
  }
  async function loadHistory() {
    if (!network.usdt || !wallet) { setHistory([]); setHistoryError('Switch to BSC Mainnet to view USDT activity.'); return; }
    setHistoryLoading(true);
    try {
      if (bscscanKey.trim()) {
        // BscScan community API provides this BSC-specific BEP-20 transfer endpoint.
        const query = new URLSearchParams({ module: 'account', action: 'tokentx', contractaddress: network.usdt, address: wallet.address, page: '1', offset: '50', startblock: '0', endblock: '999999999', sort: 'desc', apikey: bscscanKey.trim() });
        const response = await fetch(`https://api.bscscan.com/api?${query}`);
        if (!response.ok) throw new Error(`BscScan request failed (${response.status}).`);
        const data = await response.json();
        if (data.status !== '1' && !String(data.message || '').toLowerCase().includes('no transactions')) throw new Error(data.result || data.message || 'BscScan rejected the API key.');
        const entries = Array.isArray(data.result) ? data.result.map(tx => {
          const received = tx.to.toLowerCase() === wallet.address.toLowerCase();
          const decimals = Number(tx.tokenDecimal || 18); const status = tx.isError === '1' || tx.txreceipt_status === '0' ? 'Failed' : 'Success';
          return { hash: tx.hash, direction: received ? 'Received' : 'Sent', counterparty: received ? tx.from : tx.to, amount: format(BigInt(tx.value), decimals), time: new Date(Number(tx.timeStamp) * 1000).toLocaleString(), status };
        }) : [];
        setHistory(entries); setHistoryError(entries.length ? '' : 'No USDT deposits or withdrawals found for this account.'); return;
      }
      const latest = await provider.getBlockNumber();
      const walletTopic = ethers.zeroPadValue(wallet.address, 32);
      const eventTopic = ethers.id('Transfer(address,address,uint256)');
      const earliest = Math.max(0, latest - 20000); const collected = new Map();
      for (let end = latest; end >= earliest && collected.size < 20; end -= 1000) {
        const start = Math.max(earliest, end - 999);
        let sent = []; let received = [];
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            [sent, received] = await Promise.all([
              provider.getLogs({ address: network.usdt, fromBlock: start, toBlock: end, topics: [eventTopic, walletTopic] }),
              provider.getLogs({ address: network.usdt, fromBlock: start, toBlock: end, topics: [eventTopic, null, walletTopic] })
            ]);
            break;
          } catch (error) { if (attempt === 1) throw error; }
        }
        [...sent, ...received].forEach(log => collected.set(`${log.transactionHash}-${log.index}`, log));
      }
      const iface = new ethers.Interface(USDT_ABI);
      const logs = [...collected.values()].sort((a, b) => b.blockNumber - a.blockNumber).slice(0, 20);
      const entries = [];
      for (const log of logs) {
        const event = iface.parseLog(log); const isSent = event.args.from.toLowerCase() === wallet.address.toLowerCase();
        const [block, receipt] = await Promise.all([provider.getBlock(log.blockNumber), provider.getTransactionReceipt(log.transactionHash)]);
        entries.push({ hash: log.transactionHash, direction: isSent ? 'Sent' : 'Received', counterparty: isSent ? event.args.to : event.args.from, amount: format(event.args.value, 18), time: new Date(Number(block.timestamp) * 1000).toLocaleString(), status: receipt?.status === 1 ? 'Success' : receipt ? 'Failed' : 'Pending' });
      }
      setHistory(entries); setHistoryError(entries.length ? '' : 'No deposits or withdrawals were found in the latest 20,000 BSC blocks.');
    } catch (error) {
      console.error('USDT history request failed', error);
      setHistory([]);
      setHistoryError(`History could not load: ${error.shortMessage || error.message || 'Unknown connection error. Check your internet connection and API token.'}`);
    }
    finally { setHistoryLoading(false); }
  }
  function saveBscscanKey(value) { const clean = value.trim(); setBscscanKey(clean); if (clean) localStorage.setItem(BSCSCAN_KEY, clean); else localStorage.removeItem(BSCSCAN_KEY); setApiSettingsOpen(false); setNotice(clean ? 'BscScan history API saved on this device.' : 'BscScan API key removed; using recent on-chain scan.'); }
  function requestSend() {
    if (!ethers.isAddress(to) || !amount || Number(amount) <= 0) return setNotice('Enter a valid recipient and positive amount.');
    setAuthorizationPassword(''); setSendAuthorization(true);
  }
  async function verifyPasswordAndSend() {
    try {
      const verified = await ethers.Wallet.fromEncryptedJson(keystore, authorizationPassword);
      if (verified.address.toLowerCase() !== wallet.address.toLowerCase()) throw new Error('Password does not unlock this account.');
      setSendAuthorization(false); setAuthorizationPassword(''); await send();
    } catch { setNotice('Authorization password is incorrect.'); }
  }
  async function verifyBiometricAndSend() {
    try {
      await BiometricAuth.authenticate({ reason: 'Authorize this wallet payment', androidTitle: 'Confirm payment', androidSubtitle: 'Use fingerprint or device lock', allowDeviceCredential: true, androidBiometryStrength: AndroidBiometryStrength.strong });
      setSendAuthorization(false); await send();
    } catch { setNotice('Fingerprint/device-lock verification was cancelled or unavailable. Use your wallet password.'); }
  }
  async function send() {
    setSending(true); setNotice('');
    try {
      const signer = wallet.connect(provider); let tx;
      if (asset === 'BNB') tx = await signer.sendTransaction({ to, value: ethers.parseEther(amount) });
      else { const c = new ethers.Contract(network.usdt, USDT_ABI, signer); tx = await c.transfer(to, ethers.parseUnits(amount, 18)); }
      const liveTx = { hash: tx.hash, direction: 'Sent', counterparty: to, amount, asset, time: new Date().toLocaleString(), status: 'Confirming' };
      setPendingTx(liveTx); setNotice(`Transaction submitted: ${tx.hash}`); setTo(''); setAmount(''); await tx.wait(); setPendingTx({ ...liveTx, status: 'Success' }); await refresh();
    } catch (e) { setPendingTx(current => current ? { ...current, status: 'Failed' } : current); setNotice(e.shortMessage || 'Transaction failed or was rejected.'); }
    finally { setSending(false); }
  }
  function lock() { setWallet(null); setMode('unlock'); setBalances({ bnb: '—', usdt: '—' }); }
  function erase() {
    if (!confirm('Remove the selected account from this device? Ensure its recovery phrase is backed up.')) return;
    const next = accounts.filter(account => account.id !== activeAccountId); persistAccounts(next); setWallet(null);
    const nextAccount = next[0]; setActiveAccountId(nextAccount?.id || null); setKeystore(nextAccount?.keystore || null); setMode(nextAccount ? 'unlock' : 'welcome');
  }
  function applyScannedValue(value) {
    const address = value.match(/0x[a-fA-F0-9]{40}/)?.[0];
    if (!address) return setNotice('QR code does not contain a valid wallet address.');
    setTo(address); setScanOpen(false); setNotice('Address scanned. Carefully verify the recipient before sending.');
  }

  if (mode === 'welcome') return <Shell network={networkKey} setNetwork={setNetworkKey}><section className="card hero"><div className="mark">⬡</div><p className="eyebrow">NON-CUSTODIAL BSC WALLET</p><h1>Your keys.<br/><em>Your assets.</em></h1><p className="muted">A testnet-first wallet for BNB Smart Chain.</p><button onClick={() => setMode('create')}>Create new wallet</button><button className="ghost" onClick={() => setMode('import')}>I have a recovery phrase</button>{accounts.length > 0 && <div className="account-picker">{accounts.map(account => <button className="account-choice" key={account.id} onClick={() => switchAccount(account.id)}><span>{account.label}</span><small>{account.address ? short(account.address) : 'Unlock to view address'}</small></button>)}</div>}</section></Shell>;
  if (mode === 'create' || mode === 'import' || mode === 'unlock') return <Shell network={networkKey} setNetwork={setNetworkKey}><section className="card form"><button className="back" onClick={() => setMode(wallet ? 'home' : 'welcome')}>← Back</button><p className="eyebrow">{mode === 'import' ? 'RESTORE EXISTING WALLET' : 'LOCAL ENCRYPTION'}</p><h2>{mode === 'create' ? 'Protect your new wallet' : mode === 'import' ? 'Restore with recovery phrase' : 'Unlock wallet'}</h2>{mode === 'import' && <><PhraseGrid phrase={seed} setPhrase={setSeed}/><input type="number" min="0" max="99" value={derivationIndex} onChange={e => setDerivationIndex(e.target.value)} placeholder="Account number (start with 0)"/><p className="hint">Fill each word in order. You may paste the full phrase into the first field. If your old address is not shown, restore the phrase again using account number 1, then 2, etc.</p></>}<input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === 'import' ? 'Create a new local password (10+ characters)' : 'Password (10+ characters)'} autoComplete="new-password"/><p className="hint">The password encrypts this device’s local copy. It is not your recovery phrase and cannot recover it.</p><button onClick={mode === 'create' ? createWallet : mode === 'import' ? importWallet : unlock}>{mode === 'unlock' ? 'Unlock' : mode === 'import' ? 'Restore wallet' : 'Continue'}</button><Notice text={notice}/></section></Shell>;
  if (mode === 'backup') return <Shell network={networkKey} setNetwork={setNetworkKey}><section className="card form"><p className="eyebrow danger">WRITE THIS DOWN OFFLINE</p><h2>Your recovery phrase</h2><div className="seed">{seed.split(' ').map((w,i) => <span key={w}>{i+1}. {w}</span>)}</div><p className="warning">Anyone with these words can take your funds. Never share them or store them in a screenshot/cloud note.</p><button onClick={() => { setSeed(''); setMode('home'); }}>I wrote it down safely</button></section></Shell>;
  return <Shell network={networkKey} setNetwork={setNetworkKey}>
    <main className="dashboard">
      <header><div><p className="eyebrow">{accounts.find(account => account.id === activeAccountId)?.label || 'ACCOUNT'}</p><h2>{short(wallet.address)}</h2><button className="copy" onClick={() => { navigator.clipboard.writeText(wallet.address); setNotice('Address copied.'); }}>Copy address</button></div><button className="lock" onClick={lock}>Lock</button></header>
      <section className="account-bar"><span>Accounts</span><div>{accounts.map(account => <button key={account.id} className={account.id === activeAccountId ? 'active-account' : ''} onClick={() => account.id !== activeAccountId && switchAccount(account.id)}>{account.label}</button>)}<button className="add-account" onClick={() => setMode('create')}>+ Add</button><button className="add-account" onClick={() => setMode('import')}>Restore</button></div></section>
      <div className="balances"><article><span>BNB</span><strong>{balances.bnb}</strong><small>BNB Smart Chain</small></article><article><span>USDT</span><strong>{balances.usdt}</strong><small>{network.usdt ? 'BEP-20 token' : 'Mainnet only in this starter'}</small></article></div>
      <div className="quick-actions"><button onClick={() => setReceiveOpen(true)}>↓ Receive</button><button onClick={() => { setAsset('USDT'); document.getElementById('send')?.scrollIntoView({ behavior: 'smooth' }); }}>Pay USDT</button></div>
      <section className="card send" id="send"><h2>Send</h2><div className="toggle"><button className={asset==='BNB'?'selected':''} onClick={()=>setAsset('BNB')}>BNB</button><button disabled={!network.usdt} className={asset==='USDT'?'selected':''} onClick={()=>setAsset('USDT')}>USDT</button></div><div className="recipient-row"><input value={to} onChange={e=>setTo(e.target.value)} placeholder="Recipient address (0x…)"/><button className="scan" onClick={() => setScanOpen(true)}>Scan QR</button></div><input value={amount} onChange={e=>setAmount(e.target.value)} placeholder={`Amount in ${asset}`} inputMode="decimal"/><button onClick={requestSend} disabled={sending}>{sending ? 'Submitting…' : `Authorize & send ${asset}`}</button><Notice text={notice}/></section>
      <section className="card history" id="history"><div className="history-head"><div><p className="eyebrow">ADDRESS-BASED BSC HISTORY</p><h2>Manual history</h2></div><div className="history-actions"><a className="refresh history-link" href={`https://bscscan.com/token/${network.usdt}?a=${wallet.address}`} target="_blank" rel="noreferrer">Full BscScan logs ↗</a><button className="refresh" onClick={loadHistory} disabled={historyLoading}>{historyLoading ? 'Loading…' : 'Refresh recent'}</button></div></div><p className="history-address">Wallet: {wallet.address}</p>{!network.usdt ? <p className="hint">Switch to BSC Mainnet to view USDT activity.</p> : historyLoading ? <p className="hint">Loading recent BNB Smart Chain activity…</p> : history.length === 0 ? <p className="hint">{historyError || 'No USDT transfers found.'}</p> : <div className="transactions">{history.map(tx => <button className="transaction" key={tx.hash} onClick={() => setSelectedTx({ ...tx, asset: 'USDT' })}><div><strong>{tx.direction === 'Received' ? 'Deposit' : 'Withdrawal'} · {tx.amount} USDT</strong><span>{short(tx.counterparty)} · {tx.time}</span></div><div className="tx-meta"><b className={`status ${tx.status.toLowerCase()}`}>{tx.status}</b><span>View receipt ↗</span></div></button>)}</div>}<p className="history-note">This history is for the wallet address shown above. Use Full BscScan logs for complete free USDT deposits and withdrawals.</p></section>
      <footer><button className="link" onClick={refresh}>Refresh balances</button><button className="link" onClick={() => document.getElementById('history')?.scrollIntoView({ behavior: 'smooth' })}>History</button><button className="link" onClick={() => setRevealPhrase(true)}>Backup phrase</button><a href={`${network.explorer}/address/${wallet.address}`} target="_blank">View on explorer ↗</a><button className="danger-link" onClick={erase}>Remove wallet from device</button></footer>
    </main>
    {receiveOpen && <ReceiveSheet address={wallet.address} chainId={network.chainId} onClose={() => setReceiveOpen(false)} />}
    {scanOpen && <QrScanner onScan={applyScannedValue} onClose={() => setScanOpen(false)} />}
    {pendingTx && <LiveConfirmation tx={pendingTx} explorer={network.explorer} onClose={() => setPendingTx(null)} onReceipt={() => { setSelectedTx(pendingTx); setPendingTx(null); }} />}
    {selectedTx && <TransactionReceipt tx={selectedTx} explorer={network.explorer} onClose={() => setSelectedTx(null)} />}
    {revealPhrase && <RecoveryPhrase wallet={wallet} onClose={() => setRevealPhrase(false)} />}
    {sendAuthorization && <PaymentAuthorization asset={asset} amount={amount} recipient={to} password={authorizationPassword} setPassword={setAuthorizationPassword} onPassword={verifyPasswordAndSend} onBiometric={verifyBiometricAndSend} onClose={() => setSendAuthorization(false)} />}
    {apiSettingsOpen && <HistoryApiSettings currentKey={bscscanKey} onSave={saveBscscanKey} onClose={() => setApiSettingsOpen(false)} />}
  </Shell>;
}
function ReceiveSheet({ address, chainId, onClose }) {
  const paymentUri = `ethereum:${address}@${chainId}`;
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="receive-sheet"><button className="close" onClick={onClose}>×</button><p className="eyebrow">RECEIVE ON BNB SMART CHAIN</p><h2>Receive crypto</h2><div className="qr"><QRCodeSVG value={paymentUri} size={210} bgColor="#fffdf8" fgColor="#18113a" level="M" includeMargin /></div><p className="address">{address}</p><button onClick={() => navigator.clipboard.writeText(address)}>Copy address</button><p className="hint">Only receive BNB Smart Chain / BEP-20 assets at this address.</p></section></div>;
}
function QrScanner({ onScan, onClose }) {
  const scannerRef = useRef(null); const [error, setError] = useState('');
  useEffect(() => {
    const scanner = new Html5Qrcode('qr-reader'); scannerRef.current = scanner; let active = true;
    scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } }, text => {
      if (!active) return; active = false; scanner.stop().catch(() => {}); onScan(text);
    }).catch(() => setError('Camera could not start. Allow camera access, then try again.'));
    return () => { active = false; scanner.stop().catch(() => {}); };
  }, [onScan]);
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="scan-sheet"><button className="close" onClick={onClose}>×</button><p className="eyebrow">SCAN QR</p><h2>Recipient address</h2><div id="qr-reader" />{error && <p className="warning">{error}</p>}<p className="hint">Scan a wallet address QR code. Always confirm the address before paying.</p></section></div>;
}
function LiveConfirmation({ tx, explorer, onClose, onReceipt }) {
  const complete = tx.status !== 'Confirming';
  return <div className="live-confirmation"><div><b className={complete ? `status ${tx.status.toLowerCase()}` : 'status pending'}>{complete ? tx.status : 'Confirming on BSC…'}</b><strong>{tx.amount} {tx.asset} payment</strong><span>{short(tx.counterparty)}</span></div><div>{complete ? <button onClick={onReceipt}>View receipt</button> : <a href={`${explorer}/tx/${tx.hash}`} target="_blank" rel="noreferrer">Track live ↗</a>}<button className="dismiss" onClick={onClose}>×</button></div></div>;
}
function TransactionReceipt({ tx, explorer, onClose }) {
  const label = tx.direction === 'Received' ? 'Sender' : 'Recipient';
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="receipt-sheet"><button className="close" onClick={onClose}>×</button><p className="eyebrow">BLOCKCHAIN RECEIPT</p><h2>{tx.status === 'Success' ? 'Payment confirmed' : tx.status}</h2><b className={`status ${tx.status.toLowerCase()}`}>{tx.status}</b><strong className="receipt-amount">{tx.direction} {tx.amount} {tx.asset || 'USDT'}</strong><dl><div><dt>{label}</dt><dd>{tx.counterparty}</dd></div><div><dt>Date & time</dt><dd>{tx.time}</dd></div><div><dt>Transaction hash</dt><dd>{tx.hash}</dd></div></dl><a className="explorer-button" href={`${explorer}/tx/${tx.hash}`} target="_blank" rel="noreferrer">View verified transaction on BscScan ↗</a></section></div>;
}
function RecoveryPhrase({ wallet, onClose }) {
  const phrase = wallet?.mnemonic?.phrase;
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="receipt-sheet phrase-sheet"><button className="close" onClick={onClose}>×</button><p className="eyebrow danger">KEEP PRIVATE</p><h2>Recovery phrase backup</h2>{phrase ? <><div className="seed">{phrase.split(' ').map((word, index) => <span key={`${word}-${index}`}>{index + 1}. {word}</span>)}</div><button onClick={() => navigator.clipboard.writeText(phrase)}>Copy phrase</button><p className="warning">Anyone who sees these words can control the wallet. Never share them, take screenshots, or send them to anyone.</p></> : <p className="hint">This account has no recovery phrase available in this app. You need the original phrase used to create or import it.</p>}</section></div>;
}
function PaymentAuthorization({ asset, amount, recipient, password, setPassword, onPassword, onBiometric, onClose }) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="receipt-sheet authorization-sheet"><button className="close" onClick={onClose}>×</button><p className="eyebrow">PAYMENT AUTHORIZATION</p><h2>Confirm payment</h2><strong className="receipt-amount">{amount} {asset}</strong><p className="hint">To: {short(recipient)}</p><button className="biometric-button" onClick={onBiometric}>Use fingerprint / device lock</button><div className="auth-divider"><span>or wallet password</span></div><input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Wallet password" autoComplete="current-password"/><button onClick={onPassword} disabled={!password}>Authorize payment</button><p className="warning">Confirm the recipient and amount. A blockchain payment cannot be reversed.</p></section></div>;
}
function HistoryApiSettings({ currentKey, onSave, onClose }) {
  const [key, setKey] = useState(currentKey);
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="receipt-sheet authorization-sheet"><button className="close" onClick={onClose}>×</button><p className="eyebrow">COMPLETE HISTORY</p><h2>Connect BscScan API</h2><p className="hint">A free BscScan API key lets this device load full USDT deposit and withdrawal history instead of only recent blocks.</p><input type="password" value={key} onChange={event => setKey(event.target.value)} placeholder="Paste your BscScan API key" autoComplete="off"/><button onClick={() => onSave(key)}>{key.trim() ? 'Save API key' : 'Use recent-block scan'}</button><p className="warning">Stored only on this device. Do not use one shared API key in a public APK—use your own backend before public release.</p><a className="key-help" href="https://bscscan.com/myapikey" target="_blank" rel="noreferrer">Get a free BscScan API key ↗</a></section></div>;
}
function Shell({ children, network, setNetwork }) { return <div className="app"><nav className="topbar"><div className="brand-lockup"><span className="brand-mark">V</span><span className="brand">VEE<span>PAY</span><small>WALLET · SELF-CUSTODY</small></span></div><div className="network-control"><i className="network-dot"/><select value={network} onChange={e=>setNetwork(e.target.value)}><option value="testnet">BSC Testnet</option><option value="mainnet">BNB Smart Chain</option></select></div></nav>{children}<p className="disclaimer">Your keys stay on your device · Educational wallet prototype</p></div>; }
function Notice({ text }) { return text && <p className="notice">{text.startsWith('0x') || text.startsWith('Transaction') ? text : text}</p>; }
function PhraseGrid({ phrase, setPhrase }) {
  const [length, setLength] = useState(12);
  const words = phrase.trim() ? phrase.trim().split(/\s+/) : [];
  function updateWord(index, value) {
    const next = Array.from({ length }, (_, position) => words[position] || '');
    next[index] = value.trim().toLowerCase(); setPhrase(next.join(' ').trim());
  }
  function pastePhrase(event) {
    const pasted = event.clipboardData.getData('text').trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (pasted.length < 2) return;
    event.preventDefault(); if (pasted.length === 24) setLength(24); setPhrase(pasted.join(' '));
  }
  return <div className="phrase-entry"><div className="phrase-head"><span>Recovery phrase</span><div><button type="button" className={length === 12 ? 'selected' : ''} onClick={() => setLength(12)}>12 words</button><button type="button" className={length === 24 ? 'selected' : ''} onClick={() => setLength(24)}>24 words</button></div></div><div className="phrase-grid">{Array.from({ length }, (_, index) => <label key={index}><span>{index + 1}</span><input value={words[index] || ''} onChange={event => updateWord(index, event.target.value)} onPaste={index === 0 ? pastePhrase : undefined} placeholder="word" autoComplete="off" autoCapitalize="none" spellCheck="false"/></label>)}</div></div>;
}
