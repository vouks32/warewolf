import { makeWASocket, useMultiFileAuthState, DisconnectReason, extractImageThumb, fetchLatestBaileysVersion, Browsers, generateWAMessageContent, getContentType } from "baileys"
import QRCode from 'qrcode'
import { WereWolvesManager } from "./GamesManagers/werewolve.js"
import { makeRetryHandler } from "./handler.js";
import { QuizManager } from "./GamesManagers/quiz.js";
import { Insult1 } from "./apis/insult.js";
import { getAllUsers, getUser, saveUser } from "./userStorage.js";
import sharp from "sharp";
import fs from "fs"
import NodeCache from "node-cache";
import { QuizManagerFR } from "./GamesManagers/quiz-fr.js";

const MAX_MESSAGES = 1000

let messagesCount = MAX_MESSAGES
let lastGroupJid = null

const wwm = new WereWolvesManager()
const qm = new QuizManager()
const qmfr = new QuizManagerFR()
const handler = makeRetryHandler();
let Interval = null;

const groupCache = new NodeCache({ stdTTL: 5 * 60, useClones: false })

async function optimizeGifSharp(gifPath, id) {
    return await sharp(gifPath)
        .resize({ width: 300 }) // Resize to 500px width
        .jpeg({ quality: 80 }).toBuffer();
}

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

const botTips = [
    ""
]

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("../auth_info")
    const { version } = await fetchLatestBaileysVersion();
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

    const sock = makeWASocket({
        version,
        auth: state,
        browser: Browsers.macOS('Desktop'),
        markOnlineOnConnect: true,
        getMessage: handler.getHandler,
        cachedGroupMetadata: async (jid) => groupCache.get(jid)
    })

    sock.ev.on("creds.update", saveCreds)
    sock.ev.on("connection.update", async (update) => {
        console.log('---------------------       connection -----------------------------------------')
        console.log(update)
        console.log('---------------------       connection -----------------------------------------')
        const { connection, lastDisconnect, qr } = update
        if (connection === "close") {
            const statusCode = lastDisconnect?.error?.output?.statusCode
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut

            console.log("connection closed due to ", lastDisconnect?.error, ", reconnecting ", shouldReconnect)

            if (shouldReconnect) startBot()
        } else if (connection === "open") {
            console.log("✅ Bot is online!")
            messagesCount = MAX_MESSAGES
            if (lastGroupJid)
                await sock.sendMessage(lastGroupJid, { text: ' --- BOT de nouveau actif --- \nJe suis de nouveau opérationnel', }).then(handler.addMessage)
            lastGroupJid = null
        }

        if (qr) {
            console.log(await QRCode.toString(qr, { type: 'terminal' }))
        }
    })
    sock.ev.on('groups.update', async ([event]) => {
        const metadata = await sock.groupMetadata(event.id)
        groupCache.set(event.id, metadata)
    })
    sock.ev.on('group-participants.update', async (event) => {
        const metadata = await sock.groupMetadata(event.id)
        groupCache.set(event.id, metadata)
    })
    // Handle messages
    sock.ev.on("messages.upsert", async (m) => {
        const msg = m.messages[0]


        if (!msg.message || msg.key.fromMe) {
            return
        }
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
        const game = !isGroup ? null : qmfr.isPlaying(remoteJid) ? "QUIZFR" : qm.isPlaying(remoteJid) ? "QUIZ" : wwm.isPlaying(remoteJid) ? "WEREWOLVE" : null

        if (isGroup) {
            lastGroupJid = remoteJid
        }
        if (text.startsWith('!') && !game && messagesCount <= 0 && isGroup) {
            await sock.sendMessage(lastGroupJid, { text: ' *--- Redémarrage de sécurité ---* \n\nLa relation toxique que j\'ai avec whatsapp m\'oblige à me redémarrer \n Patiente un peu', }, { quoted: msg }).then(handler.addMessage)
            await startBot()
            return
        }
        messagesCount--;
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
            messageType: getContentType(msg.message),
            raw: msg,

            reply: async (message, mentions = undefined) => {
                await sock.sendMessage(remoteJid, { text: htmlDecode(message) + (message.length > 300 ? '\n\n𝐯𝐨𝐮𝐤𝐬 𝐛𝐨𝐭' : ""), mentions: mentions }, { quoted: msg }).then(handler.addMessage)
            },
            delete: async () => {
                await sock.sendMessage(remoteJid, { delete: msg.key })
            },

            sendMessage: async (jid, message, mentions = undefined) => {
                await sock.sendMessage(jid, { text: htmlDecode(message) + (message.length > 300 ? '\n\n𝐯𝐨𝐮𝐤𝐬 𝐛𝐨𝐭' : ""), mentions: mentions }).then(handler.addMessage)
            },

            sendImage: async (jid, buffer, caption = "", mentions = []) => {
                if (buffer.includes('http')) {
                    await sock.sendMessage(jid, { image: { url: buffer }, caption: htmlDecode(caption), mentions }).then(handler.addMessage)
                    return
                }
                const imagename = buffer.split('/').pop()
                let optimizedImage = (await optimizeGifSharp(buffer, './images/send/opt-' + imagename))
                const t = await extractImageThumb(optimizedImage)
                await sock.sendMessage(jid, { image: optimizedImage, jpegThumbnail: t.buffer, caption: htmlDecode(caption), mentions }).then(handler.addMessage)
            },

            sendAudio: async (jid, buffer, ptt = false) => {
                await sock.sendMessage(jid, { audio: buffer, mimetype: "audio/mp4", ptt }).then(handler.addMessage)
            },

            sendVideo: async (jid, buffer, caption = "") => {
                await sock.sendMessage(jid, { video: buffer, caption: htmlDecode(caption) })
            },

            getParticipants: async (groupJid) => {
                try {
                    // Fetch group metadata
                    const metadata = await sock.groupMetadata(groupJid);

                    // Find the participant by JID
                    const participant = metadata.participants

                    return participant || null; // Return participant or null if not found
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
                if (regex.test(text.toLowerCase())) {
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
                //console.log(whatsapp.senderJid, ":", whatsapp.raw.message?.videoMessage?.contextInfo)
                console.log(whatsapp.senderJid, ":", text)
                /* */
                /*console.log("------------------------------")*/
            }
        } catch (error) {
            //await whatsapp.reply("Donc... ta commande m'a fait crasher😐\nVas savoir pourquoi... enfin bon, pas de panique, j'ai été programmé pour gérer ça")
            await whatsapp.sendMessage("237676073559@s.whatsapp.net", "Erreur négro \n\n" + error.toString() + '\nLe dernier Message :')
            await whatsapp.sendMessage("237676073559@s.whatsapp.net", "@" + whatsapp.sender.split('@')[0] + " : " + whatsapp.text, [whatsapp.sender])
            console.log(error)
        }

    })

    const repeatFunction = async () => {
        const allPlayers = getAllUsers()
        let groups = {}
        for (const playerJid in allPlayers) {
            const player = allPlayers[playerJid];
            player.groups.forEach(groupJid => {
                groups[groupJid] = groups[groupJid] ? groups[groupJid].concat(player) : [player]
            });
        }
        for (const groupJid in groups) {
            const group = groups[groupJid];
            const metadata = await sock.groupMetadata(groupJid);
            const participant = metadata.participants
            group.sort((p1, p2) => p2.points - p1.points)

            await sock.sendMessage(groupJid, {
                text: `Liste des Joueurs:\n\n` + group.map((p, i) => (i == 0 ? '🥇' : i == 1 ? '🥈' : i == 2 ? '🥉' : '[' + (i + 1) + ']') + ` - @${p.jid.split('@')[0]} *(${p.points} points)*`).join('\n')
                , mentions: group.map((p) => p.jid)
            }).then(handler.addMessage)


            for (let index = 0; index < group.length; index++) {
                const p = group[index];
                const groupParticipant = participant.find(gp => gp.id === p.jid)
                if (index < 3) {
                    if (!groupParticipant?.admin) {
                        await sock.groupParticipantsUpdate(
                            groupJid,
                            [p.jid],
                            'promote' // replace this parameter with 'remove' or 'demote' or 'promote'
                        )
                        await sock.sendMessage(groupJid, { text: `@${p.jid.split('@')[0]} a été *ajouté* à la haute sphère des Admins`, mentions: [p.jid] }).then(handler.addMessage)
                    } else if (!groupParticipant) {
                        console.log(p.jid, p.pushName, "is no more in group but top 3")
                    }
                } else {
                    if (groupParticipant?.admin === "admin" && !p.jid.includes('650687834')) {
                        await sock.groupParticipantsUpdate(
                            groupJid,
                            [p.jid],
                            'demote' // replace this parameter with 'remove' or 'demote' or 'promote'
                        )
                        await sock.sendMessage(groupJid, { text: `@${p.jid.split('@')[0]} a été *retiré* à la haute sphère des Admins`, mentions: [p.jid] }).then(handler.addMessage)
                    } else if (!groupParticipant) {
                        console.log(p.jid, p.pushName, "is no more in group")
                    }
                }
            }
        }

    }


    let timetilNext3hr = (60 * 60 * 3) - (Math.floor((new Date()).valueOf() / 1000) % (60 * 60 * 3))
    setTimeout(() => {
        //repeatFunction()
        Interval = setInterval(() => repeatFunction(), 60 * 60 * 3 * 1000)
    }, timetilNext3hr * 1000)



    //////////////////////////// UTILITIES //////////////////////////////////////////////////
    handlers.commands.set("!info", async (whatsapp) => {
        return await whatsapp.reply('Je suis un bot créé par Vouks - (676073559)\n' +
            'Mon but? Jouer avec vous pour vous distraire du fait que le monde va bientôt sombrer entre les mains des intélligences artificiels tel que moi... lors :\n\n' +
            'Pour jouer à un jeu, écris:\n\n' +
            "🐺 *!werewolve* - pour jouer au loup\n" +
            "📝 *!quizen* - pour jouer à un quiz (en Anglais)\n" +
            "📝 *!quizfr* - pour jouer à un quiz (en Français)\n" +
            "\nℹ️ *!info* - Pour tout savoir sur moi"
        )
    })

    handlers.commands.set("!tag", async (whatsapp) => {
        if (!whatsapp.isGroup) return await whatsapp.reply('Quand toi tu vois... on es dans un groupe?!')
        const participants = await whatsapp.getParticipants(whatsapp.groupJid)
        console.log(participants)
        const AdminParticipant = participants.find(_p => _p.id.includes('@lid') ? (_p.id == whatsapp.ids.lid && _p.admin) : (_p.id == whatsapp.ids.jid && _p.admin))
        if (!AdminParticipant) return await whatsapp.reply('Quand toi tu vois... Tu es Admin?!')

        const t = 'Tag Générale :\n\n' + participants.map(p => `- @${p.id.split('@')[0]}`).join('\n')
        const mentions = participants.map(p => p.id)
        await whatsapp.reply(t, mentions)
    })



    // Stop game (group)
    handlers.text.push({
        regex: /^!tagtext/,
        fn: async (whatsapp) => {
            if (!whatsapp.isGroup) return await whatsapp.reply('Quand toi tu vois... on es dans un groupe?!')
            const participants = await whatsapp.getParticipants(whatsapp.groupJid)
            console.log(participants)
            const AdminParticipant = participants.find(_p => _p.id.includes('@lid') ? (_p.id == whatsapp.ids.lid && _p.admin) : (_p.id == whatsapp.ids.jid && _p.admin))
            if (!AdminParticipant) return await whatsapp.reply('Quand toi tu vois... Tu es Admin?!')


            const text = whatsapp.text.slice(8)
            const t = '*📢 Annonce*\n\n' + text
            const mentions = participants.map(p => p.id)
            await whatsapp.reply(t, mentions)
        }
    })

    handlers.commands.set("!image", async (whatsapp) => {
        return //await whatsapp.sendImage(whatsapp.remoteJid, './images/creategame.jpg')
    })

    handlers.commands.set("!startgame", async (whatsapp) => {
        return await whatsapp.reply('Pour jouer à un jeu, écris:\n\n' +
            "🐺 *!werewolve* - pour jouer au loup\n" +
            "📝 *!quiz* - pour jouer à un quiz (en Anglais)\n" +
            "\nℹ️ *!info* - Pour tout savoir sur moi"
        )
    })

    handlers.commands.set("!profil", async (whatsapp) => {
        await wwm.sendPlayerProfil(whatsapp)
    })

    // Stop game (group)
    handlers.text.push({
        regex: /^!stopgame$/,
        fn: async (whatsapp) => {
            if (!whatsapp.isGroup) return await whatsapp.reply('Quand toi tu vois... on es dans un groupe?!')
            const participants = await whatsapp.getParticipants(whatsapp.groupJid)
            console.log(participants)
            const AdminParticipant = participants.find(_p => _p.id.includes('@lid') ? (_p.id == whatsapp.ids.lid && _p.admin) : (_p.id == whatsapp.ids.jid && _p.admin))
            if (!AdminParticipant) return await whatsapp.reply('Quand toi tu vois... Tu es Admin?!')

            if (whatsapp.game === null) return await whatsapp.reply('persone n\'est entrain de jouer à un jeu! tu es attardé?')
            else if (whatsapp.game === 'QUIZ')
                await qm.stopGame(whatsapp.groupJid, whatsapp)
            else if (whatsapp.game === 'QUIZFR')
                await qmfr.stopGame(whatsapp.groupJid, whatsapp)
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
            const participants = await whatsapp.getParticipants(whatsapp.groupJid)
            const AdminParticipant = participants.find(_p => _p.id.includes('@lid') ? (_p.id == whatsapp.ids.lid && _p.admin) : (_p.id == whatsapp.ids.jid && _p.admin))
            if (!AdminParticipant) return await whatsapp.reply('Quand toi tu vois... Tu es Admin?!')

            const name = whatsapp.text.split("!bot insulte")[1].trim().split(' ')[0]
            const user = whatsapp.ids.lid ? name.replace('@', '') + "@lid" : name.replace('@', '') + "@s.whatsapp.net"
            Insult1(whatsapp.groupJid, user, whatsapp)
        }
    })




    //////////////////////////// QUIZ //////////////////////////////////////////////////
    handlers.commands.set("!quizfr", async (whatsapp) => {
        if (!whatsapp.isGroup) return await whatsapp.reply('Ne peut être appelé que dans un groupe!')
        if (whatsapp.game !== null) return await whatsapp.reply('Un jeu est en cours dans ce groupe')
        await qmfr.createGame(whatsapp.groupJid, whatsapp)
    })

    //////////////////////////// QUIZ //////////////////////////////////////////////////
    handlers.commands.set("!quizen", async (whatsapp) => {
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
        const werewolfGroupJid = wwm.getPlayerGroupJid(whatsapp.senderJid)
        const quizGroupJid = qm.getGroupData(whatsapp.groupJid) ? whatsapp.groupJid : null
        const quizFRGroupJid = qmfr.getGroupData(whatsapp.groupJid) ? whatsapp.groupJid : null

        //console.log('type', whatsapp.messageType)
        if (werewolfGroupJid && (whatsapp.messageType.includes('video') || whatsapp.messageType.includes('image'))) {
            await wwm.addUserPoints(whatsapp.sender, whatsapp, -10, "send image during game", 0)
            await whatsapp.reply('Vous avez reçu *-10 points*')
            await whatsapp.delete()
            return
        }

        const t = whatsapp.text;
        if (t.length > 2 || !Number.isInteger(parseInt(t))) return

        const target = parseInt(t) - 1

        //console.log(" group jids of bollosses", werewolfGroupJid, quizGroupJid, quizFRGroupJid)
        if (werewolfGroupJid) {
            const targetJid = wwm.getPlayerJidFromNumber(werewolfGroupJid, target)
            await wwm.handleShortHand(werewolfGroupJid, whatsapp.sender, targetJid, whatsapp)
        }

        if (quizGroupJid) {
            await qm.handleShortHand(quizGroupJid, whatsapp.sender, target, whatsapp)
        }

        if (quizFRGroupJid) {
            await qmfr.handleShortHand(quizFRGroupJid, whatsapp.sender, target, whatsapp)
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

    // Prostitute visit
    handlers.text.push({
        regex: /^!visit\s+(\S+)/,
        fn: async (whatsapp) => {
            if (whatsapp.isGroup) return await whatsapp.reply("Cette action en peut être éffectué que dans l'intimité de notre conversation")
            const groupJid = wwm.getPlayerGroupJid(whatsapp.senderJid)
            if (!groupJid) return await whatsapp.reply("Tu n'es dans aucune partie dont j'ai connaissance")
            const target = parseInt(whatsapp.text.split(" ")[1]) - 1
            const targetJid = wwm.getPlayerJidFromNumber(groupJid, target)
            console.log("pute ---- ", groupJid, targetJid, whatsapp)
            await wwm.prostituteVisit(groupJid, whatsapp.sender, targetJid, whatsapp)
        }
    })

    // Mayor stop vote
    handlers.text.push({
        regex: /^!stopvote$/,
        fn: async (whatsapp) => {
            if (whatsapp.isGroup) return await whatsapp.reply("Cette action en peut être éffectué que dans l'intimité de notre conversation")
            const groupJid = wwm.getPlayerGroupJid(whatsapp.senderJid)
            if (!groupJid) return await whatsapp.reply("Tu n'es dans aucune partie dont j'ai connaissance")
            const target = parseInt(whatsapp.text.split(" ")[1]) - 1
            const targetJid = wwm.getPlayerJidFromNumber(groupJid, target)
            console.log("mayor ---- ", groupJid, targetJid, whatsapp)
            await wwm.mayorStopVote(groupJid, whatsapp.sender, whatsapp)
        }
    })

    // Mayor stop vote
    handlers.text.push({
        regex: /^!p$/,
        fn: async (whatsapp) => {
            if (!whatsapp.isGroup) return await whatsapp.reply('Quand toi tu vois... on es dans un groupe?!')
            const participants = await whatsapp.getParticipants(whatsapp.groupJid)
            console.log(participants)
            const AdminParticipant = participants.find(_p => _p.id.includes('@lid') ? (_p.id == whatsapp.ids.lid && _p.admin) : (_p.id == whatsapp.ids.jid && _p.admin))
            if (!AdminParticipant) return await whatsapp.reply('Quand toi tu vois... Tu es Admin?!')

            if (whatsapp.game === null) return await whatsapp.reply('persone n\'est entrain de jouer à un jeu!')
            else if (whatsapp.game === 'QUIZ') {
                //await qm.stopGame(whatsapp.groupJid, whatsapp)
            } else if (whatsapp.game === 'WEREWOLVE')
                await wwm.sendPlayerList(whatsapp.groupJid, whatsapp)
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
