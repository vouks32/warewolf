import { makeWASocket, useMultiFileAuthState, DisconnectReason } from "baileys"
import QRCode from 'qrcode'
import { WereWolvesManager } from "./GamesManagers/werewolve.js"
import { makeRetryHandler } from "./handler.js";
import { QuizManager } from "./GamesManagers/quiz.js";
import { Insult1 } from "./apis/insult.js";
import { getUser, saveUser } from "./userStorage.js";
const wwm = new WereWolvesManager()
const qm = new QuizManager()
const handler = makeRetryHandler();

function htmlDecode(text) {
    if (typeof text !== 'string') return text;
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, ' ');
}

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
        markOnlineOnConnect: false,
        getMessage: handler.getHandler
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
        const senderJid = isGroup ? (msg.key?.participant?.endsWith('@lid') && msg.key?.number ? msg.key?.number : msg.key?.participant) : remoteJid;
        const sender = senderJid

        const text = msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.imageMessage?.caption ||
            msg.message.videoMessage?.caption ||
            "";

        // Build reusable whatsapp object with proper JID information

        const game = !isGroup ? null : qm.isPlaying(remoteJid) ? "QUIZ" : wwm.isPlaying(remoteJid) ? "WEREWOLVE" : null


        const whatsapp = {
            ids: {
                lid: msg.key.participant?.endsWith('@lid') ? msg.key.participant : null,
                jid: senderJid,
            },
            isGroup,
            remoteJid,
            groupJid: isGroup ? remoteJid : null,
            privateJid: isGroup ? null : remoteJid,
            senderJid,
            sender,
            text,
            game,
            raw: msg,

            reply: async (message, mentions = undefined) => {
                await sock.sendMessage(remoteJid, { text: htmlDecode(message) + (message.length > 300 ? '\n\n𝐯𝐨𝐮𝐤𝐬 𝐛𝐨𝐭' : ""), mentions: mentions }, { quoted: msg }).then(handler.addMessage)
            },

            sendMessage: async (jid, message, mentions = undefined) => {
                await sock.sendMessage(jid, { text: htmlDecode(message) + (message.length > 300 ? '\n\n𝐯𝐨𝐮𝐤𝐬 𝐛𝐨𝐭' : ""), mentions: mentions }).then(handler.addMessage)
            },

            sendImage: async (jid, buffer, caption = "") => {
                await sock.sendMessage(jid, { image: buffer, caption: htmlDecode(caption) }).then(handler.addMessage)
            },

            sendAudio: async (jid, buffer, ptt = false) => {
                await sock.sendMessage(jid, { audio: buffer, mimetype: "audio/mp4", ptt }).then(handler.addMessage)
            },

            sendVideo: async (jid, buffer, caption = "") => {
                await sock.sendMessage(jid, { video: buffer, caption: htmlDecode(caption) })
            },

            sendGif: async (jid, buffer, caption = "", mentions = []) => {
                await sock.sendMessage(jid, { video: { url: buffer, gifAttribution: 0 }, gifPlayback: true, caption, mentions });
                await sock.sendMessage(jid, { video: { url: buffer }, gifPlayback: true, caption, mentions });
            },

            getParticipants: async (groupJid) => {
                try {
                    // Fetch group metadata
                    const metadata = await sock.groupMetadata(groupJid);

                    // Find the participant by JID
                    const participant = metadata.participants

                    return metadata || null; // Return participant or null if not found
                } catch (error) {
                    console.error('Error fetching group metadata:', error);
                    return null;
                }
            },
            getContact: async (jid) => {
                try {
                    // Get contact information
                    const contact = await sock.getContact(jid);

                    return contact;
                } catch (error) {
                    console.error('Error fetching contact:', error);
                    return null;
                }
            }
        }

        // Attach middleware methods
        registerHandlers(whatsapp)


        // Dispatch logic
        let handled = false

        try {
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
                    handled = true
                }
            }


            if (handled) {
                console.log(whatsapp.senderJid, ":", whatsapp.raw.message?.videoMessage?.contextInfo)
                console.log(whatsapp.senderJid, ":", whatsapp.raw.message?.videoMessage)
                /* const user = getUser(whatsapp.senderJid)
                 if (!user) {
                     saveUser({ id: whatsapp.senderJid, groups: whatsapp.isGroup ? [whatsapp.groupJid] : [], dateCreated: Date.now(), pushName: whatsapp.raw?.pushName })
                 } else {
                     if (whatsapp.isGroup && !user.groups.some(g => g === whatsapp.groupJid)) {
                         user.groups.push(whatsapp.groupJid)
                         saveUser(user)
                     }
                 }*/
                /*console.log("------------------------------")*/
            }
        } catch (error) {
            //await whatsapp.reply("Donc... ta commande m'a fait crasher😐\nVas savoir pourquoi... enfin bon, pas de panique, j'ai été programmé pour gérer ça")
            await whatsapp.sendMessage("237676073559@s.whatsapp.net", "Erreur négro \n\n" + error.toString())
        }

    })

    //////////////////////////// UTILITIES //////////////////////////////////////////////////
    handlers.commands.set("!info", async (whatsapp) => {
        return await whatsapp.reply('Je suis un bot créé par Vouks - (676073559)\n' +
            'Mon but? Jouer avec vous pour vous distraire du fait que le monde va bientôt sombrer entre les mains des intélligences artificiels tel que moi... lors :\n\n' +
            'Pour jouer à un jeu, écris:\n\n' +
            "🐺 *!werewolve* - pour jouer au loup\n" +
            "📝 *!quiz* - pour jouer à un quiz (en Anglais)\n" +
            "\nℹ️ *!info* - Pour tout savoir sur moi"
        )
    })

    handlers.commands.set("!gif", async (whatsapp) => {
        return await whatsapp.sendGif(whatsapp.remoteJid, 'https://media1.tenor.com/m/JBaptPbqOVMAAAAd/howling-our-living-world.gif')
    })

    handlers.commands.set("!startgame", async (whatsapp) => {
        return await whatsapp.reply('Pour jouer à un jeu, écris:\n\n' +
            "🐺 *!werewolve* - pour jouer au loup\n" +
            "📝 *!quiz* - pour jouer à un quiz (en Anglais)\n" +
            "\nℹ️ *!info* - Pour tout savoir sur moi"
        )
    })

    // Village vote (group)
    handlers.text.push({
        regex: /^!stop/,
        fn: async (whatsapp) => {
            if (!whatsapp.isGroup) return await whatsapp.reply('Ne peut être appelé que dans un groupe!')

            if (whatsapp.game === null) return await whatsapp.reply('persone n\'est entrain de jouer à un jeu! tu es attardé?')
            else if (whatsapp.game === 'QUIZ')
                await qm.stopGame(whatsapp.groupJid, whatsapp)
            else if (whatsapp.game === 'WEREWOLVE')
                await wwm.stopGame(whatsapp.groupJid, whatsapp)
        }
    })

    // MENTION
    handlers.text.push({
        regex: /^!mention/,
        fn: async (whatsapp) => {
            if (!whatsapp.isGroup) return await whatsapp.reply('Ne peut être appelé que dans un groupe!')
            if (whatsapp.text.split(" ").length == 1 || whatsapp.text.split(" ")[1].trim().length == 0) return await whatsapp.reply('tu n\'as pas fournis la personne que je dois mentionner... envoie *!mention _@pseudo_* pour mentioner !')

            const name = whatsapp.text.split(" ")[1]
            whatsapp.reply("I mention : " + name, [name.replace('@', '') + "@lid"])
        }
    })

    // MENTION
    handlers.text.push({
        regex: /!bot insulte/,
        fn: async (whatsapp) => {
            if (!whatsapp.isGroup) return await whatsapp.reply('Ne peut être appelé que dans un groupe!')
            if (whatsapp.text.split("!bot insulte").length == 1 || whatsapp.text.split("!bot insulte")[1].trim().length == 0) return await whatsapp.reply('Moi je vois pas celui que tu veux que j\'insulte 🤷‍♂️')

            const name = whatsapp.text.split("!bot insulte")[1].trim().split(' ')[0]
            const user = whatsapp.ids.lid ? name.replace('@', '') + "@lid" : name.replace('@', '') + "@s.whatsapp.net"
            Insult1(whatsapp.groupJid, user, whatsapp)
        }
    })




    //////////////////////////// QUIZ //////////////////////////////////////////////////
    handlers.commands.set("!quiz", async (whatsapp) => {
        if (!whatsapp.isGroup) return await whatsapp.reply('Ne peut être appelé que dans un groupe!')
        if (whatsapp.game !== null) return await whatsapp.reply('Un jeu est en cours dans ce groupe')
        await qm.createGame(whatsapp.groupJid, whatsapp)
    })

    // Village vote (group)
    handlers.text.push({
        regex: /^!cat\s+/,
        fn: async (whatsapp) => {
            if (!whatsapp.isGroup) return await whatsapp.reply('Ne peut être appelé que dans un groupe!')

            const categoryIndex = parseInt(whatsapp.text.split(" ")[1]) - 1

            await qm.castVoteCategory(whatsapp.groupJid, whatsapp.sender, categoryIndex, whatsapp)
        }
    })

    // Village vote (group)
    handlers.text.push({
        regex: /^!ans\s+/,
        fn: async (whatsapp) => {
            if (!whatsapp.isGroup) return await whatsapp.reply('Ne peut être appelé que dans un groupe!')

            const answer = parseInt(whatsapp.text.split(" ")[1]) - 1

            await qm.answerQuestion(whatsapp.groupJid, whatsapp.sender, answer, whatsapp)
        }
    })



    // SHORT HAND NUMBER WHEN IN GAME
    handlers.any.push(async (whatsapp) => {
        const t = whatsapp.text;
        if (t.length > 2 || !Number.isInteger(parseInt(t))) return

        const werewolfGroupJid = wwm.getPlayerGroupJid(whatsapp.senderJid)
        const quizGroupJid = qm.getGroupData(whatsapp.groupJid) ? whatsapp.groupJid : null
        const target = parseInt(t) - 1

        console.log(" group jids of bollosses", werewolfGroupJid, quizGroupJid)
        if (werewolfGroupJid) {
            const targetJid = wwm.getPlayerJidFromNumber(werewolfGroupJid, target)
            await wwm.handleShortHand(werewolfGroupJid, whatsapp.sender, targetJid, whatsapp)
        }

        if (quizGroupJid) {
            await qm.handleShortHand(quizGroupJid, whatsapp.sender, target, whatsapp)
        }
    }
    )



    ////////////////////////////////////////////        WEREWOLVES         ////////////////////////////////////////////////// 
    // Start game in group
    handlers.commands.set("!werewolve", async (whatsapp) => {
        if (!whatsapp.isGroup) return await whatsapp.reply('Ne peut être appelé que dans un groupe!')
        if (whatsapp.game !== null) return await whatsapp.reply('Un jeu est en cours dans ce groupe')
        await wwm.createGame(whatsapp.groupJid, whatsapp)
    })

    // join
    handlers.text.push({
        regex: /^!play/,
        fn: async (whatsapp) => {
            if (!whatsapp.isGroup) return await whatsapp.reply('Ne peut être appelé que dans un groupe!')
            if (whatsapp.text.split(" ").length == 1 || whatsapp.text.split(" ")[1].trim().length == 0) return await whatsapp.reply('You didn\'t provide any name... Send *!play _pseudo_* to join !')

            const name = whatsapp.text.split(" ")[1]
            await wwm.joinGame(whatsapp.groupJid, whatsapp.senderJid, name, whatsapp)
        }
    })

    // Wolves kill (private DM only)
    handlers.text.push({
        regex: /^!kill\s+(\S+)/,
        fn: async (whatsapp) => {
            if (whatsapp.isGroup) return await whatsapp.reply("Cette action en peut être éffectué que dans l'intimité de notre conversation")
            const groupJid = wwm.getPlayerGroupJid(whatsapp.senderJid)
            if (!groupJid) return await whatsapp.reply("Tu n'es dans aucune partie dont j'ai connaissance")
            const target = parseInt(whatsapp.text.split(" ")[1]) - 1
            const targetJid = wwm.getPlayerJidFromNumber(groupJid, target)
            console.log("wolf ---- ", groupJid, whatsapp.sender, targetJid, whatsapp)
            await wwm.wolfKill(groupJid, whatsapp.sender, targetJid, whatsapp)
        }
    })

    // Village vote (group) [DAY]
    handlers.text.push({
        regex: /^!vote\s+(\S+)/,
        fn: async (whatsapp) => {
            if (!whatsapp.isGroup) return await whatsapp.reply('Ne peut être appelé que dans un groupe!')

            const target = parseInt(whatsapp.text.split(" ")[1]) - 1
            const targetJid = wwm.getPlayerJidFromNumber(whatsapp.groupJid, target)

            console.log("vote ---- ", whatsapp.groupJid, targetJid, whatsapp)
            await wwm.castVote(whatsapp.groupJid, whatsapp.sender, targetJid, whatsapp)
        }
    })

    // Seer action
    handlers.text.push({
        regex: /^!see\s+(\S+)/,
        fn: async (whatsapp) => {
            if (whatsapp.isGroup) return await whatsapp.reply("Cette action en peut être éffectué que dans l'intimité de notre conversation")
            const groupJid = wwm.getPlayerGroupJid(whatsapp.senderJid)
            if (!groupJid) return await whatsapp.reply("Tu n'es dans aucune partie dont j'ai connaissance")
            const target = parseInt(whatsapp.text.split(" ")[1]) - 1
            const targetJid = wwm.getPlayerJidFromNumber(groupJid, target)
            console.log("see ---- ", groupJid, targetJid, whatsapp)
            await wwm.seerInspect(groupJid, targetJid, whatsapp)
        }
    })

    // Doctor action
    handlers.text.push({
        regex: /^!save\s+(\S+)/,
        fn: async (whatsapp) => {
            if (whatsapp.isGroup) return await whatsapp.reply("Cette action en peut être éffectué que dans l'intimité de notre conversation")
            const groupJid = wwm.getPlayerGroupJid(whatsapp.senderJid)
            if (!groupJid) return await whatsapp.reply("Tu n'es dans aucune partie dont j'ai connaissance")

            const target = parseInt(whatsapp.text.split(" ")[1]) - 1
            const targetJid = wwm.getPlayerJidFromNumber(groupJid, target)
            await wwm.doctorSave(groupJid, targetJid, whatsapp)
        }
    })

    // hunter
    handlers.text.push({
        regex: /^!shoot/,
        fn: async (whatsapp) => {
            if (whatsapp.isGroup) return await whatsapp.reply("Cette action en peut être éffectué que dans l'intimité de notre conversation")
            const groupJid = wwm.getPlayerGroupJid(whatsapp.senderJid)
            if (!groupJid) return await whatsapp.reply("Tu n'es dans aucune partie dont j'ai connaissance")

            const target = parseInt(whatsapp.text.split(" ")[1]) - 1
            const targetJid = wwm.getPlayerJidFromNumber(groupJid, target)
            await wwm.hunterShoot(groupJid, targetJid, whatsapp)
        }
    })

    // witch heal
    handlers.text.push({
        regex: /^!heal$/,
        fn: async (whatsapp) => {
            if (whatsapp.isGroup) return await whatsapp.reply("Cette action en peut être éffectué que dans l'intimité de notre conversation")
            const groupJid = wwm.getPlayerGroupJid(whatsapp.senderJid)
            if (!groupJid) return await whatsapp.reply("Tu n'es dans aucune partie dont j'ai connaissance")

            await wwm.witchHeal(groupJid, whatsapp)
        }
    })
    // witch poison
    handlers.text.push({
        regex: /^!poison\s+(\S+)/,
        fn: async (whatsapp) => {
            if (whatsapp.isGroup) return await whatsapp.reply("Cette action en peut être éffectué que dans l'intimité de notre conversation")
            const groupJid = wwm.getPlayerGroupJid(whatsapp.senderJid)
            if (!groupJid) return await whatsapp.reply("Tu n'es dans aucune partie dont j'ai connaissance")

            const target = parseInt(whatsapp.text.split(" ")[1]) - 1
            const targetJid = wwm.getPlayerJidFromNumber(groupJid, target)
            await wwm.witchPoison(groupJid, targetJid, whatsapp)
        }
    })
    // love cupid
    handlers.text.push({
        regex: /^!love\s+(\S+)\s+(\S+)/,
        fn: async (whatsapp) => {
            if (whatsapp.isGroup) return await whatsapp.reply("Cette action en peut être éffectué que dans l'intimité de notre conversation")
            const groupJid = wwm.getPlayerGroupJid(whatsapp.senderJid)
            if (!groupJid) return await whatsapp.reply("Tu n'es dans aucune partie dont j'ai connaissance")

            const target1 = parseInt(whatsapp.text.split(" ")[1]) - 1
            const target2 = parseInt(whatsapp.text.split(" ")[2]) - 1

            const targetJid1 = wwm.getPlayerJidFromNumber(groupJid, target1)
            const targetJid2 = wwm.getPlayerJidFromNumber(groupJid, target2)
            console.log("cupid pair : ----- ", groupJid, target1, target2, targetJid1, targetJid2, whatsapp)
            await wwm.cupidPair(groupJid, targetJid1, targetJid2, whatsapp)
        }
    })


}

startBot()
