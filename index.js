import { makeWASocket, useMultiFileAuthState, DisconnectReason } from "baileys"
import QRCode from 'qrcode'
import { GameManager } from "./gameManager.js"
const gm = new GameManager()

function parseMessage(msg) {
    const remoteJid = msg.key.remoteJid;
    const isGroup = remoteJid.endsWith('@g.us');

    let groupJid = null;
    let privateJid = null;
    let senderJid = null;

    if (isGroup) {
        groupJid = remoteJid;
        // For group messages, the actual sender is in the participant field
        senderJid = msg.key.participant || remoteJid;
    } else {
        privateJid = remoteJid;
        senderJid = remoteJid; // For private messages, sender is the remoteJid
    }

    return {
        isGroup,
        groupJid,
        privateJid,
        senderJid,
        text: extractText(msg),
        raw: msg
    };
}

function extractText(msg) {
    if (msg.message.conversation) {
        return msg.message.conversation;
    } else if (msg.message.extendedTextMessage && msg.message.extendedTextMessage.text) {
        return msg.message.extendedTextMessage.text;
    } else if (msg.message.imageMessage && msg.message.imageMessage.caption) {
        return msg.message.imageMessage.caption;
    } else if (msg.message.videoMessage && msg.message.videoMessage.caption) {
        return msg.message.videoMessage.caption;
    }
    return "";
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("auth_info")
    const sock = makeWASocket({
        auth: state,
        markOnlineOnConnect: false
    })

    sock.ev.on("creds.update", saveCreds)

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update
        if (connection === "close") {
            const statusCode = lastDisconnect?.error?.output?.statusCode
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut

            console.log("connection closed due to ", lastDisconnect?.error, ", reconnecting ", shouldReconnect)

            if (shouldReconnect) startBot()
        } else if (connection === "open") {
            console.log("✅ Bot is online!")
        }

        if (qr) {
            console.log(await QRCode.toString(qr, { type: 'terminal' }))
        }
    })


    // Handlers storage
    const handlers = {
        commands: new Map(),   // command -> callback
        text: [],              // regex -> callback
        any: [],               // callback
    }

    // Register handlers API
    function registerHandlers(whatsapp) {
        whatsapp.onCommand = (cmd, fn) => {
            handlers.commands.set(cmd.toLowerCase(), fn)
        }
        whatsapp.onText = (regex, fn) => {
            handlers.text.push({ regex, fn })
        }
        whatsapp.onAny = (fn) => {
            handlers.any.push(fn)
        }
    }

    // Handle messages
    sock.ev.on("messages.upsert", async (m) => {
        const msg = m.messages[0]
        if (!msg.message || msg.key.fromMe) return

        // Parse the message to get type and JIDs
        const remoteJid = msg.key.remoteJid;
        const isGroup = remoteJid.endsWith('@g.us');
        const senderJid = isGroup ? msg.key.participant : remoteJid;
        const sender = senderJid

        const text = msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.imageMessage?.caption ||
            msg.message.videoMessage?.caption ||
            "";

        // Build reusable whatsapp object with proper JID information
        const whatsapp = {
            isGroup,
            groupJid: isGroup ? remoteJid : null,
            privateJid: isGroup ? null : remoteJid,
            senderJid,
            sender,
            text,
            raw: msg,

            reply: async (message, mentions = []) => {
                await sock.sendMessage(remoteJid, { text: message, mentions: mentions }, { quoted: msg })
            },

            sendMessage: async (jid, message, mentions = []) => {
                await sock.sendMessage(jid, { text: message, mentions: mentions })
            },

            sendImage: async (jid, buffer, caption = "") => {
                await sock.sendMessage(jid, { image: buffer, caption })
            },

            sendAudio: async (jid, buffer, ptt = false) => {
                await sock.sendMessage(jid, { audio: buffer, mimetype: "audio/mp4", ptt })
            },

            sendVideo: async (jid, buffer, caption = "") => {
                await sock.sendMessage(jid, { video: buffer, caption })
            },
        }

        // Attach middleware methods
        registerHandlers(whatsapp)



        // Dispatch logic
        let handled = false

        // Command match (exact)
        if (handlers.commands.has(text.toLowerCase())) {
            await handlers.commands.get(text.toLowerCase())(whatsapp)
            handled = true
        }

        // Regex/text match
        for (const { regex, fn } of handlers.text) {
            if (regex.test(text)) {
                await fn(whatsapp)
                handled = true
            }
        }

        // Fallback "any" handlers
        if (!handled) {
            for (const fn of handlers.any) {
                await fn(whatsapp)
            }
        }
    })



    // Start game in group
    handlers.commands.set("!startgame", async (whatsapp) => {
        if (!whatsapp.isGroup) return await whatsapp.reply('This can only be called in a group!')
        await gm.createGame(whatsapp.groupJid, whatsapp)
    })

    // Join game
    /* handlers.commands.set("!play", async (whatsapp) => {
         gm.joinGame(whatsapp.sender, whatsapp.sender, whatsapp)
     })*/


    /*// Example: regex handler
    handlers.text.push({
        regex: /hi|hello|salut|bonjour/i,
        fn: async (whatsapp) => {
            await whatsapp.reply("👋 Salut!")
            await sendTheMenu(whatsapp, false)
        },
    })

    // Example: any handler
    handlers.any.push(async (whatsapp) => {
        console.log(`📩 [${whatsapp.sender}] ${whatsapp.text}`)
        if (!whatsapp.text.toLowerCase().startsWith("menu")) {
            await sendTheMenu(whatsapp)
        }
    })*/


    handlers.text.push({
        regex: /^!play/,
        fn: async (whatsapp) => {
            if (!whatsapp.isGroup) return await whatsapp.reply('This can only be called in a group!')
            if (whatsapp.text.split(" ").length == 1 || whatsapp.text.split(" ")[1].trim().length == 0) return await whatsapp.reply('You didn\'t provide any name... Send *!play _pseudo_* to join !')

            const name = whatsapp.text.split(" ")[1]
            await gm.joinGame(whatsapp.groupJid, whatsapp.senderJid, name, whatsapp)
        }
    })

    // Wolves kill (private DM only)
    handlers.text.push({
        regex: /^!kill\s+(\S+)/,
        fn: async (whatsapp) => {
            if (whatsapp.isGroup) return await whatsapp.reply('This action can only be perform in the intimacy of our private discussion!')
            const groupJid = gm.getPlayerGroupJid(whatsapp.senderJid)
            if (!groupJid) return await whatsapp.reply('You are in no party I know of!')
            const target = whatsapp.text.split(" ")[1]
            const targetJid = gm.getPlayerJidFromNumber(groupJid, target)

            await gm.wolfKill(groupJid, whatsapp.sender, targetJid, whatsapp)
        }
    })

    // Village vote (group)
    handlers.text.push({
        regex: /^!vote\s+(\S+)/,
        fn: async (whatsapp) => {
            if (!whatsapp.isGroup) return await whatsapp.reply('This can only be called in a group!')

            const target = whatsapp.text.split(" ")[1]
            const targetJid = gm.getPlayerJidFromNumber(whatsapp.groupJid, target)

            await gm.castVote(whatsapp.groupJid, whatsapp.sender, targetJid, whatsapp)
        }
    })

    // Seer action
    handlers.text.push({
        regex: /^!see\s+(\S+)/,
        fn: async (whatsapp) => {
            if (whatsapp.isGroup) return await whatsapp.reply('This action can only be perform in the intimacy of our private discussion!')
            const groupJid = gm.getPlayerGroupJid(whatsapp.senderJid)
            if (!groupJid) return await whatsapp.reply('You are in no party I know of!')
            const target = whatsapp.text.split(" ")[1]
            const targetJid = gm.getPlayerJidFromNumber(whatsapp.groupJid, target)
            await gm.seerInspect(groupJid, targetJid, whatsapp)
        }
    })

    // Doctor action
    handlers.text.push({
        regex: /^!save\s+(\S+)/,
        fn: async (whatsapp) => {
            if (whatsapp.isGroup) return await whatsapp.reply('This action can only be perform in the intimacy of our private discussion!')
            const groupJid = gm.getPlayerGroupJid(whatsapp.senderJid)
            if (!groupJid) return await whatsapp.reply('You are in no party I know of!')

            const target = whatsapp.text.split(" ")[1]
            const targetJid = gm.getPlayerJidFromNumber(whatsapp.groupJid, target)
            await gm.doctorSave(groupJid, targetJid, whatsapp)
        }
    })

    // hunter
    handlers.text.push({
        regex: /^!shoot\s+(\S+)/,
        fn: async (whatsapp) => {
            if (whatsapp.isGroup) return await whatsapp.reply('This action can only be perform in the intimacy of our private discussion!')
            const groupJid = gm.getPlayerGroupJid(whatsapp.senderJid)
            if (!groupJid) return await whatsapp.reply('You are in no party I know of!')

            const target = whatsapp.text.split(" ")[1]
            const targetJid = gm.getPlayerJidFromNumber(whatsapp.groupJid, target)
            await gm.hunterShoot(groupJid, targetJid, whatsapp)
        }
    })

    handlers.text.push({
        regex: /^!heal$/,
        fn: async (whatsapp) => {
            if (whatsapp.isGroup) return await whatsapp.reply('This action can only be perform in the intimacy of our private discussion!')
            const groupJid = gm.getPlayerGroupJid(whatsapp.senderJid)
            if (!groupJid) return await whatsapp.reply('You are in no party I know of!')

            await gm.witchHeal(groupJid, whatsapp)
        }
    })
    handlers.text.push({
        regex: /^!poison\s+(\S+)/,
        fn: async (whatsapp) => {
            if (whatsapp.isGroup) return await whatsapp.reply('This action can only be perform in the intimacy of our private discussion!')
            const groupJid = gm.getPlayerGroupJid(whatsapp.senderJid)
            if (!groupJid) return await whatsapp.reply('You are in no party I know of!')

            const target = whatsapp.text.split(" ")[1]
            const targetJid = gm.getPlayerJidFromNumber(whatsapp.groupJid, target)
            await gm.witchPoison(groupJid, targetJid, whatsapp)
        }
    })

    handlers.text.push({
        regex: /^!love\s+(\S+)\s+(\S+)/,
        fn: async (whatsapp) => {
            if (whatsapp.isGroup) return await whatsapp.reply('This action can only be perform in the intimacy of our private discussion!')
            const groupJid = gm.getPlayerGroupJid(whatsapp.senderJid)
            if (!groupJid) return await whatsapp.reply('You are in no party I know of!')

            const target1 = whatsapp.text.split(" ")[1]
            const target2 = whatsapp.text.split(" ")[2]

            const targetJid1 = gm.getPlayerJidFromNumber(whatsapp.groupJid, target1)
            const targetJid2 = gm.getPlayerJidFromNumber(whatsapp.groupJid, target2)
            await gm.cupidPair(groupJid, targetJid1, targetJid2, whatsapp)
        }
    })


}

startBot()
