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
import { fancyTransform } from './TextConverter.js'


const MAX_MESSAGES = 1000

let messagesCount = MAX_MESSAGES
let lastGroupJid = null

const handler = makeRetryHandler();
let Interval = null;

const groupCache = new NodeCache({ stdTTL: 5 * 60, useClones: false })

async function optimizeGifSharp(gifPath, width = 300, quality = 80) {
    return await sharp(gifPath)
        .resize({ width }) // Resize to 500px width
        .jpeg({ quality }).toBuffer();
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

    const wwm = new WereWolvesManager(sock)
    const qm = new QuizManager()
    const qmfr = new QuizManagerFR()

    // Whatsapp Events
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
                await sock.sendMessage(lastGroupJid, { text: fancyTransform(' --- BOT de nouveau actif --- \nJe suis de nouveau opérationnel'), }).then(handler.addMessage)
            lastGroupJid = null

            // init games
            setTimeout(async () => {
                await wwm.init({
                    sender: null,
                    sendMessage: async (jid, message, mentions = undefined) => {
                        await sock.sendMessage(jid, { text: fancyTransform(htmlDecode(message) + (message.length > 300 ? '\n\n𝐯𝐨𝐮𝐤𝐬 𝐛𝐨𝐭' : "")), mentions: mentions }).then(handler.addMessage)
                    },
                    sendImage: async (jid, buffer, caption = "", mentions = []) => {
                        if (buffer.includes('http')) {
                            await sock.sendMessage(jid, { image: { url: buffer }, caption: fancyTransform(htmlDecode(caption)), mentions }).then(handler.addMessage)
                            return
                        }
                        /* const imagename = buffer.split('/').pop()
                 let optimizedImage = (await optimizeGifSharp(buffer))
                 let t = (await optimizeGifSharp(buffer, 32, 80))
                 try {
                     t = await extractImageThumb(optimizedImage)
                     await sock.sendMessage(jid, { image: optimizedImage, jpegThumbnail: t.buffer, caption: htmlDecode(caption), mentions }).then(handler.addMessage)
                 } catch (error) {
                     console.log("couldn't get thumbnail")
                 }
                 await sock.sendMessage(jid, { image: optimizedImage, caption: htmlDecode(caption), mentions }).then(handler.addMessage)*/
                        await sock.sendMessage(jid, { text: fancyTransform(htmlDecode(caption) + (caption.length > 300 ? '\n\n𝐯𝐨𝐮𝐤𝐬 𝐛𝐨𝐭' : "")), mentions: mentions }).then(handler.addMessage)
                    }
                })
            }, 2000)
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

        for (const p of event.participants) {
            if (event.action === "add") {
                const text = `Bienvenue @${p.split('@')[0]},\n\nJe suis un bot donc pas la peine de me repondre, je m'en fou\n\nIci personne ne se connait donc ne soit pas peur, parle nous\n\nIci il y a plein de jeux mais on joue tout le temps au jeu du loups donc...\n\nEnvoie *!info* pour en savoir plus`
                await sock.sendMessage(event.id, { text: fancyTransform(text), mentions: [p, '237676073559@s.whatsapp.net'] })
            }
        }

    })
    // Handle messages
    sock.ev.on("messages.upsert", async (m) => {

        for (const msg of m.messages) {
            //console.log(msg)

            if (msg.key && msg.key.remoteJid == 'status@broadcast') {
                //console.log("status message")
                continue
            }

            if (msg.key.fromMe) {
                continue
            }


            console.log('---------------------       message -----------------------------------------')
            // Parse the message to get type and JIDs
            const remoteJid = msg.key.remoteJid;
            const isGroup = remoteJid.endsWith('@g.us');
            const senderJid = isGroup ? (msg.key?.participantPn ? msg.key?.participantPn : msg.key?.participantLid) : remoteJid;
            const sender = senderJid
            const isViewOnce = msg.key?.isViewOnce || msg.message?.viewOnceMessage || msg.message?.viewOnceMessageV2 || msg.message?.viewOnceMessageV2Extension
            const msgKeys = Object.keys(msg.message || {})
            const messageType = msgKeys > 0 ? msgKeys[0] : null
            const content = msg.message ? msg.message[messageType] : {}
            const text = msg.message?.conversation ||
                msg.message?.extendedTextMessage?.text ||
                msg.message?.imageMessage?.caption ||
                msg.message?.videoMessage?.caption ||
                "";
            const mentions = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid ||
                msg.message?.imageMessage?.contextInfo?.mentionedJid ||
                msg.message?.videoMessage?.contextInfo?.mentionedJid ||
                [];

            //console.log(`[DEBUG] parsed text="${text}" from=${senderJid} isGroup=${isGroup} messageType=${getContentType(msg.message)}`);

            if (text.includes('@')) console.log(msg)
            if (text.includes('@')) console.log(msg.message.extendedTextMessage)

            // Build reusable whatsapp object with proper JID information
            const game = !isGroup ? null : qmfr.isPlaying(remoteJid) ? "QUIZFR" : qm.isPlaying(remoteJid) ? "QUIZ" : wwm.isPlaying(remoteJid) ? "WEREWOLVE" : null

            if (!senderJid || !remoteJid || senderJid.length == 0) {
                console.log("--> no senderJid")
                continue
            }

            if (isGroup) {
                lastGroupJid = remoteJid
            }
            if (text.startsWith('!') && !game && messagesCount <= 0 && isGroup) {
                await sock.sendMessage(lastGroupJid, { text: fancyTransform(' *--- Redémarrage de sécurité ---* \n\nLa relation toxique que j\'ai avec whatsapp m\'oblige à me redémarrer \n Patiente un peu'), }, { quoted: msg }).then(handler.addMessage)
                await startBot()
                continue
            }
            messagesCount--;
            const whatsapp = {
                ids: {
                    lid: isGroup ? (msg.key.participantLid || msg.key.participant || null) : msg.key.senderLid || null,
                    jid: senderJid,
                },
                isGroup,
                remoteJid,
                groupJid: isGroup ? remoteJid : null,
                privateJid: isGroup ? null : remoteJid,
                senderJid,
                sender,
                text,
                mentions,
                game,
                messageType: getContentType(msg.message) || "",
                isViewOnce,
                isForward: (content?.contextInfo?.isForwarded || content?.contextInfo?.forwardingScore > 0),
                isReaction: (msg.message?.reactionMessage),
                raw: msg,

                reply: async (message, mentions = undefined) => {
                    await sock.sendMessage(remoteJid, { text: fancyTransform(htmlDecode(message) + (message.length > 300 ? '\n\n𝐯𝐨𝐮𝐤𝐬 𝐛𝐨𝐭' : "")), mentions: mentions }, { quoted: getContentType(msg) ? msg : undefined }).then(handler.addMessage)
                },
                delete: async () => {
                    await sock.sendMessage(remoteJid, { delete: msg.key })
                },

                sendMessage: async (jid, message, mentions = undefined) => {
                    await sock.sendMessage(jid, { text: fancyTransform(htmlDecode(message) + (message.length > 300 ? '\n\n𝐯𝐨𝐮𝐤𝐬 𝐛𝐨𝐭' : "")), mentions: mentions }).then(handler.addMessage)
                },

                sendImage: async (jid, buffer, caption = "", mentions = []) => {
                    if (buffer.includes('http')) {
                        await sock.sendMessage(jid, { image: { url: buffer }, caption: fancyTransform(htmlDecode(caption)), mentions }).then(handler.addMessage)
                        return
                    }

                    const text = "======================\n\n" +
                        htmlDecode(caption) +
                        "\n\n======================"
                    await sock.sendMessage(jid, { text: fancyTransform(text), mentions: mentions }).then(handler.addMessage)

                },

                sendAudio: async (jid, buffer, ptt = false) => {
                    await sock.sendMessage(jid, { audio: buffer, mimetype: "audio/mp4", ptt }).then(handler.addMessage)
                },

                sendVideo: async (jid, buffer, caption = "") => {
                    await sock.sendMessage(jid, { video: buffer, caption: fancyTransform(htmlDecode(caption)) })
                },

                getParticipants: async (groupJid) => {
                    try {
                        // Fetch group metadata
                        const metadata = await sock.groupMetadata(groupJid);

                        // Find the participant by JID
                        const participant = metadata.participants

                        return participant.map(p => ({ ...p, id: p.jid || p.id })) || null; // Return participant or null if not found
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
            let process = true


            try {

                //Check if can talk
                const werewolfGroupJid = wwm.getPlayerGroupJid(senderJid)
                if (werewolfGroupJid && (whatsapp.messageType.includes('video') || whatsapp.messageType.includes('image') || isViewOnce || whatsapp.isForward)) {
                    await wwm.addUserPoints(whatsapp.sender, whatsapp, -15, "send image during game", 0)
                    await whatsapp.sendMessage(whatsapp.remoteJid, `@${whatsapp.senderJid.split('@')[0]}` + ', vous avez reçu *-15 points* pour avoir envoyé une image/vidéo pendant la partie', [whatsapp.senderJid])
                    await whatsapp.delete()
                    process = false
                    handled = true
                }
                if (whatsapp.isGroup && whatsapp.isReaction && whatsapp.isGroup && !wwm.playerCanSpeak(whatsapp.senderJid, whatsapp.groupJid)) {
                    if (whatsapp.senderJid.includes('x650687834') || whatsapp.senderJid.includes('x676073559')) { } else {
                        const ans = [
                            `@${whatsapp.sender.split('@')[0]} on est pas dans ton village ici, les morts ne réagissent pas\nVous avez reçu *-5 points*`,
                            `@${whatsapp.sender.split('@')[0]} Tu es mort et tu envoie les réactions ehh, *-5 points*`,
                            `@${whatsapp.sender.split('@')[0]} Si tu voulais trop réagir fallait le faire de ton vivant , *-5 points*`,
                        ]
                        await whatsapp.sendMessage(whatsapp.remoteJid, ans[Math.floor(Math.random() * ans.length)], [whatsapp.sender])
                        await wwm.addUserPoints(whatsapp.sender, whatsapp, -5, "réagis étant mort", 0)
                        process = false
                        handled = true
                    }
                }

                // Command match (exact)
                if (process)
                    if (handlers.commands.has(text.toLowerCase().trim())) {
                        await handlers.commands.get(text.toLowerCase().trim())(whatsapp)
                        console.log("Handled command", text.toLowerCase().trim())
                        handled = true
                    }

                // Regex/text match
                if (process)
                    for (const { regex, fn } of handlers.text) {
                        if (regex.test(text.toLowerCase().trim())) {
                            await fn(whatsapp)
                            console.log("regex Handled command", text.toLowerCase().trim())
                            handled = true
                        }
                    }

                //console.log('handled', handled, "process", process, whatsapp.senderJid, ":", text)

                // Fallback "any" handlers
                if (!handled) {
                    for (const fn of handlers.any) {
                        await fn(whatsapp)
                        handled = true
                    }
                }




            } catch (error) {
                //await whatsapp.reply("Donc... ta commande m'a fait crasher😐\nVas savoir pourquoi... enfin bon, pas de panique, j'ai été programmé pour gérer ça")
                await whatsapp.sendMessage("237676073559@s.whatsapp.net", "Erreur négro \n\n" + error.toString() + '\nLe dernier Message :')
                await whatsapp.sendMessage("237676073559@s.whatsapp.net", "@" + whatsapp.sender.split('@')[0] + " : " + whatsapp.text, [whatsapp.sender])
                console.log(error)
            }
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
                text: fancyTransform(`Liste des Joueurs de *${metadata.subject}*:\n\n` + group.map((p, i) => (i == 0 ? '🥇' : i == 1 ? '🥈' : i == 2 ? '🥉' : (i == 3 || i == 4) ? '🏅' : '[' + (i + 1) + ']') + ` - @${p.jid.split('@')[0]} *(${p.points} points)*`).join('\n'))
                , mentions: group.map((p) => p.jid)
            }).then(handler.addMessage)


            for (let index = 0; index < group.length; index++) {
                const p = group[index];
                const groupParticipant = participant.find(gp => gp.id === p.jid)
                if (index < 5) {
                    if (!groupParticipant?.admin) {
                        await sock.groupParticipantsUpdate(
                            groupJid,
                            [p.jid],
                            'promote' // replace this parameter with 'remove' or 'demote' or 'promote'
                        )
                        await sock.sendMessage(groupJid, { text: fancyTransform(`@${p.jid.split('@')[0]} a été *ajouté* à la haute sphère des Admins`), mentions: [p.jid] }).then(handler.addMessage)
                    } else if (!groupParticipant) {
                        console.log(p.jid, p.pushName, "is no more in group but top 3")
                    }
                } else {
                    if (groupParticipant?.admin && !p.jid.includes('650687834')) {
                        await sock.groupParticipantsUpdate(
                            groupJid,
                            [p.jid],
                            'demote' // replace this parameter with 'remove' or 'demote' or 'promote'
                        )
                        await sock.sendMessage(groupJid, { text: `@${p.jid.split('@')[0]} a été *retiré* de la haute sphère des Admins`, mentions: [p.jid] }).then(handler.addMessage)
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
        return await whatsapp.reply('Je suis un bot créé par Vouks - (@237676073559)\n' +
            'Mon but? Jouer avec vous pour vous distraire du fait que le monde va bientôt sombrer entre les mains des intélligences artificiels tel que moi... lors :\n\n' +
            'Pour jouer à un jeu, écris:\n\n' +
            "🐺 *!werewolve* - pour jouer au loup\n" +
            "📝 *!quizen* - pour jouer à un quiz (en Anglais)\n" +
            "📝 *!quizfr* - pour jouer à un quiz (en Français)\n" +
            "\nℹ️ *!info* - Pour tout savoir sur moi"
            , ['237676073559@s.whatsapp.net'])
    })

    handlers.commands.set("!infowerewolve", async (whatsapp) => {

        if (!whatsapp.isGroup) return await whatsapp.reply('Quand toi tu vois... on es dans un groupe?!')
        const participants = await whatsapp.getParticipants(whatsapp.groupJid)
        ////console.log(participants)
        const AdminParticipant = participants.find(_p => _p.id.includes('@lid') ? (_p.id == whatsapp.ids.lid && _p.admin && _p.admin.includes('super')) : (_p.id == whatsapp.ids.jid && _p.admin) && _p.admin.includes('super'))
        if (!AdminParticipant) return await whatsapp.reply('Mon chaud... tu n\'es pas *super admin*, donc laisse!')


        const rulesMessage = `
🐺 *BIENVENUE DANS LE JEU DES LOUPS-GAROUS* 🐺

*QU'EST-CE QUE C'EST ?*
C'est un jeu d'ambiance et de déduction où deux camps s'affrontent :
• Les *Villageois* (et autres rôles spéciaux) qui veulent éliminer tous les Loups
• Les *Loups-Garous* qui mangent les villageois chaque nuit

*COMMENT JOUER ?*
1. Rejoins une partie avec *!play tonpseudo*
2. Reçois ton rôle en MP (message privé)
3. Les parties alternent entre *Nuit* et *Jour* :

🌙 *LA NUIT* :
- Les Loups choisissent une victime (*!eat numéro*)
- Les rôles spéciaux agissent (Voyante, Docteur, Sorcière...)
- Tout se passe en MP

☀️ *LE JOUR* :
- Tout le monde discute en groupe
- On vote pour exécuter un suspect (*!vote numéro*)
- Les morts ne peuvent plus parler (sauf la nuit !)

*QUELQUES RÔLES IMPORTANTS* :
• 🐺 *Loup-Garou* - Mange les joueurs la nuit
• 🔮 *Voyante* - Peut découvrir un rôle chaque nuit
• 💉 *Docteur* - Sauve un joueur des loups
• 🧪 *Sorcière* - Peut soigner ou empoisonner (1 fois chaque)
• ❤️ *Cupidon* - Lie deux amoureux (s'ils meurent, l'autre aussi)
• 💄 *Prostituée* - Bloque un joueur (mais meurt si c'est un loup)
• 🎭 *Fou* - Reçoit un faux rôle et doit faire croire qu'il est un autre rôle

*COMMANDES UTILES* :
• *!werewolve* - Démarrer une partie
• *!play pseudo* - Rejoindre la partie
• *!vote numéro* - Voter contre un joueur
• *!profil* - Voir ton profil et tes points

*CONSEILS AUX DÉBUTANTS* :
1. Cache bien ton rôle !
2. Observe les comportements des autres
3. Les loups mentent, les villageois cherchent des incohérences
4. Ne révèle pas ton rôle sans raison

*POINTS ET RÉCOMPENSES* :
Tu gagnes des points en :
- Gagnant une partie (+10)
- Devinant un loup (+3)
- Utilisant bien ton rôle spécial (+2 à +5)
Et tu en perds si :
- Tu votes un innocent (-1)
- Tu parles quand tu es mort (-5)

*VEUX-TU ESSAYER ?* 😈
Démarre une partie avec *!werewolve* ou rejoins-en une avec *!play tonpseudo* !
`;
        return await whatsapp.reply(rulesMessage, participants.map(p => p.id))
    })

    handlers.commands.set("!tag", async (whatsapp) => {
        if (!whatsapp.isGroup) return await whatsapp.reply('Quand toi tu vois... on es dans un groupe?!')
        const participants = await whatsapp.getParticipants(whatsapp.groupJid)
        //console.log(participants)
        const AdminParticipant = participants.find(_p => _p.id.includes('@lid') ? (_p.id == whatsapp.ids.lid && _p.admin) : (_p.id == whatsapp.ids.jid && _p.admin))
        if (!AdminParticipant) return await whatsapp.reply('Quand toi tu vois... Tu es Admin?!')


        const allPlayers = getAllUsers()
        for (const playerJid in allPlayers) {
            const player = allPlayers[playerJid];
            if (participants.find(p => p.jid === player.jid)) {
                saveUser({ ...player, lid: participants.find(p => p.jid === player.jid).lid })
            }
        }

        const t = 'Tag Générale :\n\n' + participants.map(p => `- @${p.id.split('@')[0]}`).join('\n')
        const mentions = participants.map(p => p.id)
        await whatsapp.reply(t, mentions)
    })


    handlers.commands.set("!rank", async (whatsapp) => {
        if (!whatsapp.isGroup) return await whatsapp.reply('Quand toi tu vois... on es dans un groupe?!')

        console.log('[DEBUG] !rank called by', whatsapp.senderJid, 'text:', whatsapp.text, 'group:', whatsapp.groupJid)

        const participants = await whatsapp.getParticipants(whatsapp.groupJid)
        console.log('[DEBUG] group participants:', participants.map(p => ({ id: p.id || p.jid, admin: p.admin })))

        // Détection d'admin plus robuste (compare la partie avant @)
        const senderLocal = whatsapp.senderJid.split('@')[0]
        const AdminParticipant = participants.find(p => {
            const pid = (p.id || p.jid || '').toString()
            if (!pid) return false
            const pidLocal = pid.split('@')[0]
            return pidLocal === senderLocal && !!p.admin
        })

        if (!AdminParticipant) {
            // Pour debug, on affiche quand même; si tu veux restreindre -> décommente return
            //await whatsapp.reply('Tu n\'es pas admin, j\'affiche quand même le classement (debug).')
            return await whatsapp.reply('Quand toi tu vois... Tu es Admin?!')
        }

        const groupId = whatsapp.groupJid
        const allPlayers = getAllUsers()
        let group = []
        for (const playerJid in allPlayers) {
            const player = allPlayers[playerJid];
            if (player.groups.some(gJID => gJID === groupId))
                group.push(player)
        }

        try {
            const metadata = await sock.groupMetadata(groupId);
            group.sort((p1, p2) => p2.points - p1.points)

            await sock.sendMessage(groupId, {
                text: `Liste des Joueurs de *${metadata.subject}*:\n\n` + group.map((p, i) =>
                    (i == 0 ? '🥇' : i == 1 ? '🥈' : i == 2 ? '🥉' : '[' + (i + 1) + ']') + ` - @${p.jid.split('@')[0]} *(${p.points} points)*`
                ).join('\n'),
                mentions: group.map((p) => p.jid)
            }).then(handler.addMessage)
        } catch (err) {
            console.log('[ERROR] !rank handler', err)
            await whatsapp.reply('Erreur lors de la récupération du classement. Check logs.')
        }
    })

    // Alias en français
    handlers.commands.set("!rang", handlers.commands.get("!rank"))


    handlers.commands.set("!resetrank", async (whatsapp) => {
        if (!whatsapp.isGroup) return await whatsapp.reply('Quand toi tu vois... on es dans un groupe?!')
        const participants = await whatsapp.getParticipants(whatsapp.groupJid)
        //console.log(participants)
        const AdminParticipant = participants.find(_p => _p.id.includes('@lid') ? (_p.id == whatsapp.ids.lid && _p.admin && _p.admin.toLowerCase().includes('super')) : (_p.id == whatsapp.ids.jid && _p.admin) && _p.admin.toLowerCase().includes('super'))
        if (!AdminParticipant) return await whatsapp.reply('Quand toi tu vois... Tu es SUPER Admin?!')

        const groupId = whatsapp.groupJid

        const allPlayers = getAllUsers()
        let group = []
        for (const playerJid in allPlayers) {
            const player = allPlayers[playerJid];
            if (player.groups.some(gJID => gJID === groupId)) {
                player.points = 50
                player.games.WEREWOLF = 0
                saveUser(player)
                group.push(player)
            }
        }

        const metadata = await sock.groupMetadata(groupId);

        await sock.sendMessage(groupId, {
            text: `Liste des Joueurs de *${metadata.subject}*:\n\n` + group.map((p, i) => ('[' + (i + 1) + ']') + ` - @${p.jid.split('@')[0]} *(${p.points} points)*`).join('\n')
            , mentions: group.map((p) => p.jid)
        }).then(handler.addMessage)

    })



    // Stop game (group)
    handlers.text.push({
        regex: /^!tagtext/,
        fn: async (whatsapp) => {
            if (!whatsapp.isGroup) return await whatsapp.reply('Quand toi tu vois... on es dans un groupe?!')
            const participants = await whatsapp.getParticipants(whatsapp.groupJid)
            //console.log(participants)
            const AdminParticipant = participants.find(_p => _p.id.includes('@lid') ? (_p.id == whatsapp.ids.lid && _p.admin && _p.admin.includes('super')) : (_p.id == whatsapp.ids.jid && _p.admin) && _p.admin.includes('super'))
            if (!AdminParticipant) {
                await wwm.checkIfCanSpeak(whatsapp.groupJid, whatsapp.sender, whatsapp)
                return
            }


            const text = whatsapp.text.slice(8)
            const t = '*📢 Annonce*\n\n' + text
            const mentions = participants.map(p => p.id)
            await whatsapp.reply(t, mentions)
        }
    })

    // Send +5 points
    handlers.text.push({
        regex: /^!sendpoints/,
        fn: async (whatsapp) => {
            if (!whatsapp.isGroup) return await whatsapp.reply('Quand toi tu vois... on es dans un groupe?!')
            const participants = await whatsapp.getParticipants(whatsapp.groupJid)
            //console.log(participants)
            const AdminParticipant = participants.find(_p => _p.id.includes('@lid') ? (_p.id == whatsapp.ids.lid && _p.admin && _p.admin.includes('super')) : (_p.id == whatsapp.ids.jid && _p.admin) && _p.admin.includes('super'))
            if (!AdminParticipant) {
                await wwm.checkIfCanSpeak(whatsapp.groupJid, whatsapp.sender, whatsapp)
                return
            }


            const ids = whatsapp.mentions
            const amount = whatsapp.text.split("!sendpoints")[1].trim().split(' ')[whatsapp.text.split("!sendpoints")[1].trim().split(' ').length - 1]

            const allPlayers = getAllUsers()


            for (let i = 0; i < ids.length; i++) {
                const id = ids[i];
                if (id.includes('@lid')) {
                    for (const playerJid in allPlayers) {
                        const player = allPlayers[playerJid];
                        if (player.lid === id) {
                            await wwm.addUserPoints(playerJid, whatsapp, parseInt(amount), "envoyé par super admin", 0)
                            await whatsapp.reply(`@${id.split('@')[0]} a reçu *+${amount} points*`, [id])
                        }
                    }

                } else {
                    await wwm.addUserPoints(id, whatsapp, parseInt(amount), "envoyé par super admin", 0)
                    await whatsapp.reply(`@${id.split('@')[0]} a reçu *+${amount} points*`, [id])
                }
            }

        }
    })

    // remove -5 points
    handlers.text.push({
        regex: /^!removepoints/,
        fn: async (whatsapp) => {
            if (!whatsapp.isGroup) return await whatsapp.reply('Quand toi tu vois... on es dans un groupe?!')
            const participants = await whatsapp.getParticipants(whatsapp.groupJid)
            //console.log(participants)
            const AdminParticipant = participants.find(_p => _p.id.includes('@lid') ? (_p.id == whatsapp.ids.lid && _p.admin && _p.admin.includes('super')) : (_p.id == whatsapp.ids.jid && _p.admin) && _p.admin.includes('super'))
            if (!AdminParticipant) {
                await wwm.checkIfCanSpeak(whatsapp.groupJid, whatsapp.sender, whatsapp)
                return await whatsapp.reply('Mon chaud... tu n\'es pas *super admin*, donc laisse!')
            }



            const ids = whatsapp.mentions
            const amount = whatsapp.text.split("!removepoints")[1].trim().split(' ')[whatsapp.text.split("!removepoints")[1].trim().split(' ').length - 1]

            const allPlayers = getAllUsers()


            for (let i = 0; i < ids.length; i++) {
                const id = ids[i];
                if (id.includes('@lid')) {
                    for (const playerJid in allPlayers) {
                        const player = allPlayers[playerJid];
                        if (player.lid === id) {
                            await wwm.addUserPoints(playerJid, whatsapp, -parseInt(amount), "envoyé par super admin", 0)
                            await whatsapp.reply(`@${id.split('@')[0]} a été déduit *-${amount} points*`, [id])
                        }
                    }

                } else {
                    await wwm.addUserPoints(id, whatsapp, -parseInt(amount), "envoyé par super admin", 0)
                    await whatsapp.reply(`@${id.split('@')[0]} a été déduit *-${amount} points*`, [id])
                }
            }

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

    handlers.commands.set("!points", async (whatsapp) => {
        await wwm.sendPlayerPoints(whatsapp)
    })

    // Stop game (group)
    handlers.text.push({
        regex: /^!stopgame$/,
        fn: async (whatsapp) => {
            if (!whatsapp.isGroup) return await whatsapp.reply('Quand toi tu vois... on es dans un groupe?!')

            const participants = await whatsapp.getParticipants(whatsapp.groupJid)
            //console.log(participants)
            const AdminParticipant = participants.find(_p => _p.id.includes('@lid') ? (_p.id == whatsapp.ids.lid && _p.admin && _p.admin.includes('super')) : (_p.id == whatsapp.ids.jid && _p.admin && _p.admin.includes('super')))
            if (!AdminParticipant) {
                await wwm.checkIfCanSpeak(whatsapp.groupJid, whatsapp.sender, whatsapp)
                return await whatsapp.reply('Mon chaud... tu n\'es pas *super admin*, donc laisse!')
            }

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


    // NOTE player
    handlers.text.push({
        regex: /!note/,
        fn: async (whatsapp) => {
            if (!whatsapp.isGroup) return await whatsapp.reply('Ne peut être appelé que dans un groupe!')

            const t = whatsapp.text.split("!note")[1].trim().split(' ')[0]
            const target = parseInt(t) - 1
            if (!(target >= 0 && target < 10) || t.length > 2) return await wwm.setNote(whatsapp.groupJid, null, null, whatsapp)

            const text = whatsapp.text.split("!note")[1].trim().split(' ')[1] || null

            if (whatsapp.game === null) return await whatsapp.reply('persone n\'est entrain de jouer à un jeu! tu es attardé?')
            if (whatsapp.game === 'WEREWOLVE') {
                const werewolfGroupJid = wwm.getPlayerGroupJid(whatsapp.senderJid)
                const targetJid = wwm.getPlayerJidFromNumber(werewolfGroupJid, target)

                if (!text || text.length > 12) return await wwm.setNote(whatsapp.groupJid, targetJid, null, whatsapp)

                await wwm.setNote(whatsapp.groupJid, targetJid, text, whatsapp)
            }
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
        if (werewolfGroupJid && (whatsapp.messageType.includes('video') || whatsapp.messageType.includes('image') || whatsapp.isViewOnce || whatsapp.isForward)) {
            await wwm.addUserPoints(whatsapp.sender, whatsapp, -30, "send image during game", 0)
            await whatsapp.reply('Vous avez reçu *-30 points* pour avoir envoyé une image/vidéo pendant la partie')
            await whatsapp.delete()
            return
        }

        if (whatsapp.isReaction && whatsapp.isGroup && !wwm.playerCanSpeak(whatsapp.senderJid, whatsapp.groupJid)) {
            const ans = [
                `@${whatsapp.sender.split('@')[0]} on est pas dans ton village ici, les morts ne réagissent pas\nVous avez reçu *-5 points*`,
                `@${whatsapp.sender.split('@')[0]} Tu es mort et tu envoie les réactions ehh, *-5 points*`,
                `@${whatsapp.sender.split('@')[0]} Si tu voulais trop réagir fallait le faire de ton vivant , *-5 points*`,
            ]
            await whatsapp.reply(ans[Math.floor(Math.random() * ans.length)], [whatsapp.sender])
            await wwm.addUserPoints(whatsapp.sender, whatsapp, -5, "réagis étant mort", 0)
            return
        }

        const t = whatsapp.text.trim();
        if ((t.length > 2 || Number.isNaN(parseInt(t))) && whatsapp.isGroup) {
            await wwm.checkIfCanSpeak(whatsapp.groupJid, whatsapp.sender, whatsapp)
            return
        }

        const target = parseInt(t) - 1

        if (target < 0 || t.length == 0) return

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
        console.log("Creating game...")
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

    // Wolves eat (private DM only)
    handlers.text.push({
        regex: /^!eat\s+(\S+)/,
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
    /* handlers.text.push({
         regex: /^!p$/,
         fn: async (whatsapp) => {
             if (!whatsapp.isGroup) return await whatsapp.reply('Quand toi tu vois... on es dans un groupe?!')
             const participants = await whatsapp.getParticipants(whatsapp.groupJid)
             //console.log(participants)
             const AdminParticipant = participants.find(_p => _p.id.includes('@lid') ? (_p.id == whatsapp.ids.lid && _p.admin) : (_p.id == whatsapp.ids.jid && _p.admin))
             if (!AdminParticipant) return await whatsapp.reply('Quand toi tu vois... Tu es Admin?!')
 
             if (whatsapp.game === null) return await whatsapp.reply('persone n\'est entrain de jouer à un jeu!')
             else if (whatsapp.game === 'QUIZ') {
                 //await qm.stopGame(whatsapp.groupJid, whatsapp)
             } else if (whatsapp.game === 'WEREWOLVE')
                 await wwm.sendPlayerList(whatsapp.groupJid, whatsapp)
         }
     })*/

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

    // Serial Killer
    handlers.text.push({
        regex: /^!kill\s+(\S+)/,
        fn: async (whatsapp) => {
            if (whatsapp.isGroup) return await whatsapp.reply("Cette action ne peut être effectuée qu'en privé")
            const groupJid = wwm.getPlayerGroupJid(whatsapp.senderJid)
            if (!groupJid) return await whatsapp.reply("Tu n'es dans aucune partie")
            const target = parseInt(whatsapp.text.split(" ")[1]) - 1
            const targetJid = wwm.getPlayerJidFromNumber(groupJid, target)
            await wwm.serialKill(groupJid, whatsapp.sender, targetJid, whatsapp)
        }
    })

    // Pyromaniac
    handlers.text.push({
        regex: /^!(oil|ignite)\s*(\S*)/,
        fn: async (whatsapp) => {
            if (whatsapp.isGroup) return await whatsapp.reply("Cette action ne peut être effectuée qu'en privé")
            const groupJid = wwm.getPlayerGroupJid(whatsapp.senderJid)
            if (!groupJid) return await whatsapp.reply("Tu n'es dans aucune partie")

            const action = whatsapp.text.split(" ")[0].substring(1) // oil ou ignite
            let targetJid = null

            if (action === 'oil') {
                const target = parseInt(whatsapp.text.split(" ")[1]) - 1
                targetJid = wwm.getPlayerJidFromNumber(groupJid, target)
            }

            await wwm.pyromaniacAction(groupJid, whatsapp.sender, action, targetJid, whatsapp)
        }
    })


}

startBot()
