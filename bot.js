const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');

const warningData = {}; // In-memory warning tracking

async function startSock() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const sock = makeWASocket({
        auth: state,
        browser: ['Ubuntu', 'Chrome', '22.04'],
        // printQRInTerminal: true, // deprecated
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('📱 Scan this QR Code:\n', qr);
        }

        if (connection === 'close') {
            const shouldReconnect =
                (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('🔌 Connection closed. Reconnecting:', shouldReconnect);
            if (shouldReconnect) startSock();
        } else if (connection === 'open') {
            console.log('✅ Successfully connected to WhatsApp!');
        }
    });

    // 👇 Message handler
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const sender = msg.key.participant || msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            '';

        console.log(`📨 ${sender} said:`, text);

        const badWords = ['idiot', 'stupid', 'dumb'];
        const isBad = badWords.some(word =>
            text.toLowerCase().includes(word)
        );

        if (isBad) {
            warningData[sender] = (warningData[sender] || 0) + 1;

            if (warningData[sender] < 3) {
                await sock.sendMessage(from, {
                    text: `⚠️ Warning ${warningData[sender]}/3: Please avoid using bad language.`,
                });
                console.log(`⚠️ Warning sent to ${sender}`);
            } else if (isGroup) {
                try {
                    await sock.groupParticipantsUpdate(from, [sender], 'remove');
                    await sock.sendMessage(from, {
                        text: `🚫 ${sender} has been removed from the group after 3 warnings.`,
                    });
                    console.log(`🚫 ${sender} removed from group.`);
                    delete warningData[sender]; // reset after kick
                } catch (err) {
                    console.error('❌ Failed to remove user:', err);
                }
            } else {
                await sock.sendMessage(from, {
                    text: `⚠️ Final warning (3/3). Since this is not a group chat, you won’t be removed.`,
                });
            }
        }
    });
}

startSock();
