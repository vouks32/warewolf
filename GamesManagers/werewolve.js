// gameManager.js
import fs from "fs"
import path from "path"
import RoleManager from "./werewolve-utils/roleManager.js"
import { getUser, saveUser, POINTS_LIST } from "../userStorage.js"


const DATA_FILE = path.join(process.cwd(), "games/werewolves.json")
const IMAGE_FILE = path.join(process.cwd(), "images")

let timers = {}

// --- Utilities ---
function delay(ms) {
    return new Promise(resolve => {
        setTimeout(() => {
            resolve();
        }, ms);
    });
}

function pickRandomRoles(players) {
    const roles = []
    const total = players.length
    const wolfCount = Math.max(1, Math.floor(total * 0.2))

    // Wolves
    for (let i = 0; i < wolfCount; i++) roles.push("WEREWOLF")
    // Villagers for rest
    while (roles.length < total) roles.push("VILLAGER")

    // Shuffle roles
    for (let i = roles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
            ;[roles[i], roles[j]] = [roles[j], roles[i]]
    }
    return roles
}

// --- Main Manager ---
export class WereWolvesManager {
    constructor() {
        this.games = this.loadGames()
    }

    async init(whatsapp) {
        for (const groupId in this.games) {
            if (timers[groupId])
                for (let i = 0; i < timers[groupId].length; i++) {
                    const timer = timers[groupId][i];
                    if (!timer) continue
                    try {
                        clearTimeout(timer)
                    } catch (e) {
                    }
                }
            else
                timers[groupId] = [null, null, null, null, null, null, null]

            const game = this.games[groupId]
            await whatsapp.sendMessage(groupId, "*--- Partie en cours ---*\n\nUne partie était en cours avant que le bot ne redémarre. Reprise de la partie")
            switch (game.state) {
                case "WAITING_PLAYERS":
                    timers[groupId][0] = setTimeout(async () => {
                        await this.startGame(groupId, whatsapp)
                    }, 1 * 60 * 1000)
                    timers[groupId][1] = setTimeout(async () => {
                        await whatsapp.sendMessage(groupId, "🎮 30 secs restantes pour rejoindre la partie! \nEnvoie *!play _pseudo_*")
                    }, 30 * 1000)
                    timers[groupId][2] = setTimeout(async () => {
                        await whatsapp.sendMessage(groupId, "🎮 15 secs restante pour rejoindre la partie! \nEnvoie *!play _pseudo_*")
                    }, 45 * 1000)
                    break;
                case "ASSIGNING_ROLES":
                    game.state = "WAITING_PLAYERS"
                    await this.startGame(groupId, whatsapp)
                    break;
                case "NIGHT":
                    game.state = "ASSIGNING_ROLES"
                    await this.startNight(groupId, whatsapp)
                    break;
                case "DAY":
                    game.state = "NIGHT"
                    await this.startDay(groupId, whatsapp)
                    break;
                default:
                    whatsapp.sendMessage(groupId, 'Partie annulé, veillez envoyer *!werewolve* pour relancer une partie')
                    delete this.games[groupId]
                    this.saveGames(this.games)
                    break;
            }
        }
    }

    //////////////////////////////////////////               UTILITIES                     ////////////////////////////////////////////


    async addUserPoints(playerJid, whatsapp, points, reason, gamescount = 0) {
        const game = this.games[whatsapp.groupJid]
        if (!game) return
        let user = getUser(playerJid)
        let arr = {}
        arr[reason] = points
        game.players.find(p => p.jid === playerJid).points.push(arr)

        if (!user) {
            saveUser({ jid: playerJid, groups: [whatsapp.groupJid], dateCreated: Date.now(), pushName: whatsapp.raw?.pushName || ' ', games: { WEREWOLF: gamescount }, points: 50, pointsTransactions: [arr] })
            await this.sendPlayerProfil(whatsapp)
        } else {
            if (!user.groups.some(g => g === whatsapp.groupJid)) {
                user.groups.push(whatsapp.groupJid)
            }
            user.points += points
            user.games.WEREWOLF += gamescount
            user.pointsTransactions.push(arr)
            user = saveUser(user)
        }
    }


    loadGames() {
        //return {}
        if (!fs.existsSync(DATA_FILE)) return {}
        return JSON.parse(fs.readFileSync(DATA_FILE))
    }

    saveGames(games) {
        let temp = { ...games }
        Object.entries(temp).forEach(arr => { temp[arr[0]].timer = null })
        fs.writeFileSync(DATA_FILE, JSON.stringify(temp, null, 2))
    }

    checkWin(game) {
        const alive = game.players.filter(p => !p.isDead)
        const wolves = alive.filter(p => p.role.includes("WEREWOLF"))
        const nonWolves = game.players.filter(p => !p.role.includes("WEREWOLF"))
        const nonWolvesAlive = alive.filter(p => !p.role.includes("WEREWOLF"))

        // Lovers win
        if (alive.length === 2 && alive[0].lover === alive[1].jid) {
            alive.forEach(async p => {
                await this.addUserPoints(p.jid, { groupJid: game.groupId }, POINTS_LIST.WinAsLover, "Gagné en tant qu'amoureux", 0)
            });
            return { name: "LOVERS", players: [alive[0], alive[1]] }
        }
        if (wolves.length === 0) {
            nonWolves.forEach(async p => {
                await this.addUserPoints(p.jid, { groupJid: game.groupId }, POINTS_LIST.WinAsVillager, "Gagné en tant que villageoi", 0)
            });
            return { name: "VILLAGERS", players: nonWolves }
        }
        if (wolves.length >= nonWolvesAlive.length) {
            wolves.forEach(async p => {
                await this.addUserPoints(p.jid, { groupJid: game.groupId }, POINTS_LIST.WinAsWolve, "Gagné en tant que Loup", 0)
            });
            return { name: "WOLVES", players: wolves }
        }
        return { name: null, players: null }
    }


    isPlaying(groupId) {
        const game = this.games[groupId]
        if (game) return true
        return false
    }

    getPlayerGroupJid(playerJid) {
        const grouparr = Object.entries(this.games).find(arr => arr[1].players.some(_p => _p.jid === playerJid))
        return grouparr ? grouparr[0] : null
    }

    getPlayerJidFromNumber(groupId, number) {
        const game = this.games[groupId]
        return game?.players[parseInt(number)]?.jid
    }

    //////////////////////////////////////////               GAME LOGIC                     ////////////////////////////////////////////

    async createGame(groupId, whatsapp) {
        if (this.games[groupId]) {
            await whatsapp.reply("Une partie est déjà en cours wesh!")
            return
        }
        timers[groupId] = [null, null, null, null, null, null, null]

        this.games[groupId] = {
            groupId,
            state: "WAITING_PLAYERS",
            players: [], // { jid, isPlaying, isDead, role }
            votes: {},   // daytime votes { voterJid: targetJid }
            wolfChoices: {}, // night kills { wolfJid: targetJid }
            seerChoice: null,
            lastPlayerList: Date.now(),
            doctorChoice: null,
            witchHealAvailable: true,
            witchPoisonAvailable: true,
            nights: 0,
            timer: null,
            prostituteChoice: null,  // Stores who the prostitute visited
            mayorPowerAvailable: true,  // Track if mayor can stop vote
            votesStopped: false,
            playerChangeVoteCounts: {},

            serialKillerChoice: null,
            pyromaniacOiled: [],  // Liste des joueurs trempés dans l'huile
            pyromaniacOiledTonight: false,  // Liste des joueurs trempés dans l'huile
            pyromaniacChoice: null, // 'oil' ou 'ignite'
            madManFakeRole: null, // Rôle factice assigné au MadMan
            alphaWerewolfWasConverted: false, // Si l'Alpha a déjà converti un joueur
            alphaWerewolfHasConverted: false // Si l'Alpha a déjà converti un joueur
        }

        this.saveGames(this.games)

        await whatsapp.sendImage(groupId, path.join(IMAGE_FILE, "startgame.jpg"), "🎮 Nouvelle partie de loup garou, *Awoooo!😭*.")
        await whatsapp.sendMessage(groupId, "🎮 Envoie *!play _pseudo_* pour rejoindre (3 minutes restantes)")

        timers[groupId][0] = setTimeout(async () => {
            await this.startGame(groupId, whatsapp)
        }, 3 * 60 * 1000)
        timers[groupId][1] = setTimeout(async () => {
            await whatsapp.sendMessage(groupId, "🎮 2 minute restantes pour rejoindre la partie! \nEnvoie *!play _pseudo_*")
        }, 1 * 60 * 1000)
        timers[groupId][2] = setTimeout(async () => {
            await whatsapp.sendMessage(groupId, "🎮 1 minute restante pour rejoindre la partie! \nEnvoie *!play _pseudo_*")
        }, 2 * 60 * 1000)
        timers[groupId][3] = setTimeout(async () => {
            await whatsapp.sendMessage(groupId, "🎮 30 secondes restantes pour rejoindre la partie! \nEnvoie *!play _pseudo_*.")
        }, 30000 + (2 * 60 * 1000))
        timers[groupId][4] = setTimeout(async () => {
            await whatsapp.sendMessage(groupId, "🎮 15 secondes restantes pour rejoindre la partie! \nEnvoie *!play _pseudo_*.")
        }, 45000 + (2 * 60 * 1000))
    }

    async joinGame(groupId, playerJid, name, whatsapp) {
        const game = this.games[groupId]
        if (!game || game.state !== "WAITING_PLAYERS") {
            await whatsapp.reply("⚠️ Aucune partie dans laquelle tu peux entrer pour l'instant frangin.")
            return
        }

        if (game.players.find(p => p.jid === playerJid)) {
            await whatsapp.reply("😐 Tu es déjà dans la partie nor?")
            return
        }

        if (this.getPlayerGroupJid(playerJid)) {
            await whatsapp.reply("⚠️ Tu es dans une partie dans un autre groupe, Infidèle!")
            return
        }

        game.players.push({ ids: whatsapp.ids, jid: playerJid, name, isPlaying: true, isDead: false, role: null, points: [] })
        this.saveGames(this.games)

        const names = game.players.map((p, i) => `[${i + 1}] - *${p.name}* (@${p.jid.split('@')[0]}) ` + (!p.isDead ? `😀` : `☠️ [${p.role}]`)).join("\n")
        const mentions = game.players.map((p, i) => p.jid)

        await whatsapp.reply(`✅ Tu as rejoint!\n\nListe des joueurs:\n\n${names}`, mentions)

        await this.addUserPoints(playerJid, whatsapp, 1, 'Rejoin une partie', 1)

    }

    async startGame(groupId, whatsapp) {
        const game = this.games[groupId]
        if (!game || game.state !== "WAITING_PLAYERS") return

        if (game.players.length < 4) {
            await whatsapp.sendMessage(groupId, "⚠️ Pas assez de joueurs (faut au moins 4).\nC'est quoi? vous avez pas assez d'amis? \n*Jeu annulé.*")
            await whatsapp.sendMessage(groupId, `Envoyez *"!werewolve"* pour réessayer`)
            delete this.games[groupId]
            this.saveGames(this.games)
            return
        }

        game.state = "ASSIGNING_ROLES"
        //const roles = pickRandomRoles(game.players)

        const roles = RoleManager.generateRoles(game.players.length);

        if (!RoleManager.validateRoleDistribution(roles)) {
            await whatsapp.sendMessage(groupId, "⚠️ Une erreur lors de l'assignation des rôles, my bad ✋😐🤚. Jeu annulé.");
            await whatsapp.sendMessage(groupId, `envoyez encore *"!werewolve"* pour voir si je donne bien cette fois`)
            delete this.games[groupId]
            this.saveGames(this.games)
            return;
        }

        for (let i = 0; i < game.players.length; i++) {
            const p = game.players[i];
            p.role = roles[i]

            // Assigner un faux rôle au MadMan
            if (p.role === "MADMAN") {
                const possibleFakeRoles = ["SEER", "PROSTITUTE", "MAYOR", "TANNER"]
                p.fakeRole = possibleFakeRoles[Math.floor(Math.random() * possibleFakeRoles.length)]
            }

            // Conversion Alpha Werewolf
            if (p.role === "WEREWOLF" && !game.alphaWerewolfWasConverted) {
                // Convertir un villageois en loup avec une certaine probabilité
                if ((Math.random() < 0.8 && game.players.length < 10 && game.players.length > 7) || (Math.random() < 0.5 && game.players.length > 9)) {
                    p.role = "ALPHAWEREWOLF"
                    game.alphaWerewolfWasConverted = true
                }
            }

        }

        this.saveGames(this.games)

        // DM role to each player
        for (const p of game.players) {
            if (p.role === "MADMAN")
                await whatsapp.sendMessage(p.jid, `🎭 Ton rôle est: *${p.fakeRole}*`)
            else
                await whatsapp.sendMessage(p.jid, `🎭 Ton rôle est: *${p.role}*`)

            await delay(500)
        }

        if (whatsapp.sender)
            await this.addUserPoints(whatsapp.sender, whatsapp, POINTS_LIST.StartSuccessfulGame, 'a lancé une partie de loup', 0)


        this.startNight(groupId, whatsapp)
    }

    async startNight(groupId, whatsapp) {
        const game = this.games[groupId]
        if (!game || game.state == "NIGHT") return

        game.state = "NIGHT"
        game.wolfChoices = {}
        game.nights += 1
        game.seerChoice = null
        game.prostituteChoice = null
        game.prostituteProtected = null
        game.seerFakeWolves = null
        game.doctorChoice = null
        // Remove from protected list for the next night
        game.prostituteProtected = null
        game.pyromaniacOiledTonight = false
        game.doctorChoice = false
        game.witchHeal = false
        game.serialKillerChoice = null

        this.saveGames(this.games)

        // DM prompts
        for (const p of game.players) {
            if (!p.isDead) {
                console.log("sending role to", p.name)
                await delay(1000)
                if (p.role === "WEREWOLF") {
                    await whatsapp.sendMessage(p.jid, "🐺 Nuit: \nEnvoie *!eat _numéro victime_* Pour dévorer un villageois.")
                } else if (p.role === "ALPHAWEREWOLF") {
                    await whatsapp.sendMessage(p.jid, "🐺 Nuit: \nEnvoie *!eat _numéro victime_* Pour dévorer un villageois ou le transformer en loup.")
                } else if (p.role === "SEER") {
                    await whatsapp.sendMessage(p.jid, "🔮 Nuit: \nEnvoie *!see _numéro victime_* pour voir si il est un loup.")
                } else if (p.role === "DOCTOR") {
                    await whatsapp.sendMessage(p.jid, "💉 Nuit: \nEnvoie *!save _numéro victime_* pour protéger quelqu'un.")
                } else if (p.role === "WITCH" && (game.witchHealAvailable && game.witchPoisonAvailable)) {
                    await whatsapp.sendMessage(p.jid, "🧪 Nuit: \nEnvoie \n- *!heal* (et sauve la victime des loups pour ce soir) ou \n- *!poison _numéro victime_* (pour tuer quelqu'un).\n Tu ne peux le faire qu'une fois durant tout le jeu.")
                } else if (p.role === "CUPID" && game.nights == 1) {
                    await whatsapp.sendMessage(p.jid, "❤️ Nuit: \nChoisis deux amoureux: *!love _numéro 1ère victime_ _numéro 2nd victime_* (C'est la seule chance que tu as de lier, après cette occasion tu es un simple villageois)")
                } else if (p.role === "PROSTITUTE") {
                    await whatsapp.sendMessage(p.jid, "💄 Nuit: \nEnvoie *!visit numéro client* ou *numéro client* pour visiter quelqu'un.")
                } else if (p.role === "MAYOR") {
                    await whatsapp.sendMessage(p.jid, "🤵 Tu ne peux rien faire la nuit.\nMais en journée tu peux stopper les votes en envoyant *!stopvote*")
                } else if (p.role === "SERIALKILLER") {
                    await whatsapp.sendMessage(p.jid, "🔪 Nuit: \nEnvoie *!kill _numéro victime_* pour choisir ta victime.")
                } else if (p.role === "PYROMANIAC") {
                    await whatsapp.sendMessage(p.jid, "🔥 Nuit: \nEnvoie \n- *!oil _numéro victime_* (pour tremper quelqu'un dans l'huile) ou \n- *!ignite* (pour immoler tous les joueurs trempés).")
                } else if (p.role === "TANNER") {
                    await whatsapp.sendMessage(p.jid, "🎭 Ton objectif est de te faire voter par le village. Si tu réussis, tu gagnes la partie!")
                } else if (p.role === "MADMAN") {
                    // Le MadMan reçoit son faux rôle
                    //await whatsapp.sendMessage(p.jid, `🎭 Ton rôle est: *${p.fakeRole}*`)
                    // Envoyer les instructions en fonction du faux rôle
                    if (p.fakeRole === "SEER") {
                        await whatsapp.sendMessage(p.jid, "🔮 Nuit: \nEnvoie *!see _numéro victime_* pour voir si il est un loup.")
                    } else if (p.fakeRole === "PROSTITUTE") {
                        await whatsapp.sendMessage(p.jid, "💄 Nuit: \nEnvoie *!visit numéro client* pour visiter quelqu'un.")
                    } else if (p.fakeRole === "MAYOR") {
                        await whatsapp.sendMessage(p.jid, "🤵 Tu peux stopper les votes en journée en envoyant *!stopvote*")
                    } else if (p.fakeRole === "TANNER") {
                        await whatsapp.sendMessage(p.jid, "🎭 Ton objectif est de te faire voter par le village. Si tu réussis, tu gagnes la partie!")
                    }
                    // ... autres faux rôles ...
                } else {
                    await whatsapp.sendMessage(p.jid, "😴 Nuit: \nDors paisiblement.")
                }
                if (p.role !== "VILLAGER" && p.role !== "TANNER" && p.role !== "HUNTER" && p.role !== "MAYOR" && p.fakeRole !== "MAYOR" && p.fakeRole !== "TANNER") {
                    if ((p.role === "WITCH" && (!game.witchPoisonAvailable))) continue;
                    if ((p.role === "CUPID" && game.nights !== 1)) continue;
                    await delay(1000)
                    const names = game.players.map((_p, i) => `[${i + 1}] - *${_p.name}* (@${_p.jid.split('@')[0]}) ` + (!_p.isDead ? ((p.role.includes("WEREWOLF") && _p.role.includes("WEREWOLF")) ? `🐺` : `😀`) : `☠️`)).join("\n")
                    const mentions = game.players.map((p, i) => p.jid)
                    await whatsapp.sendMessage(p.jid, "Joueurs :\n\n" + names, mentions)
                }
            }
        }

        await whatsapp.sendImage(groupId, path.join(IMAGE_FILE, "nightfall.jpg"), "🌙 La nuit est tombée... \nSeules les prostituées rodent.... Du moins... c'est ce qu'elles pensent, \n\nVous avez 2 minutes")

        // Timer ends night
        timers[groupId][0] = setTimeout(async () => {
            await this.resolveNight(groupId, whatsapp)
        }, 120 * 1000)
        timers[groupId][1] = setTimeout(async () => {
            await whatsapp.sendMessage(groupId, "🎮 90 secondes restante avant le lever du soleil!")
        }, 30 * 1000)
        timers[groupId][2] = setTimeout(async () => {
            await whatsapp.sendMessage(groupId, "🎮 60 secondes restantes avant le lever du soleil!")
        }, 60 * 1000)
        timers[groupId][3] = setTimeout(async () => {
            await whatsapp.sendMessage(groupId, "🎮 30 secondes restantes avant le lever du soleil!")
        }, 90 * 1000)
        timers[groupId][4] = setTimeout(async () => {
            await whatsapp.sendMessage(groupId, "🎮 15 secondes restantes avant le lever du soleil!")
        }, 105 * 1000)
    }

    async resolveNight(groupId, whatsapp) {

        const game = this.games[groupId]
        if (!game) return
        try {
            // Tally wolf votes
            const counts = {}
            for (const wolf in game.wolfChoices) {
                const target = game.wolfChoices[wolf]
                counts[target] = (counts[target] || 0) + 1
            }

            let wasVictim = false
            let wasHunter = false
            await whatsapp.sendImage(groupId, path.join(IMAGE_FILE, "sunrise.jpg"), "☀️ Le jour se lève...")


            // Résolution Serial Killer
            if (game.serialKillerChoice) {
                const target = game.players.find(p => p.jid === game.serialKillerChoice)
                if (target && !target.isDead) {
                    // Vérifier si la cible est protégée
                    if (!(game.doctorChoice === target.jid) && !(game.witchHealAvailable && game.witchHeal)) {
                        target.isDead = true
                        await whatsapp.sendMessage(groupId, `🔪 @${target.jid.split('@')[0]} a été tué par le tueur en série! Il était [${target.role}]`, [target.jid])
                    } else {
                        await whatsapp.sendMessage(groupId, `🔪 Le tueur en série a tenté de tuer @${target.jid.split('@')[0]} mais il a été protégé!`, [target.jid])
                    }
                }
            }

            // Résolution Pyromaniac
            if (game.pyromaniacChoice === 'ignite') {
                for (const oiledJid of game.pyromaniacOiled) {
                    const oiledPlayer = game.players.find(p => p.jid === oiledJid)
                    if (oiledPlayer && !oiledPlayer.isDead) {
                        oiledPlayer.isDead = true
                        await whatsapp.sendMessage(groupId, `🔥 @${oiledJid.split('@')[0]} a été immolé! Il était [${oiledPlayer.role}]`, [oiledJid])
                    }
                }
                game.pyromaniacOiled = []
            }

            // Résolution des loups
            for (const victimId in counts) {
                wasVictim = true;
                const victim = game.players.find(p => p.jid === victimId)
                const wolfjid = Object.entries(game.wolfChoices).find(wolf_victim => wolf_victim[1] === victim.jid)[0]
                const wolf = game.players.find(p => p.jid === wolfjid)

                if (victim.isDead) {
                    if (victimId === game.serialKillerChoice) {
                        await whatsapp.sendMessage(groupId, `🐺 Les loups sont arrivé chez @${victim.jid.split('@')[0]}, pour ne trouver qu'un cadavre planté de *${Math.floor((Math.random() * 500) + 77)} coups* de couteaux!\n Il était *[${victim.role}]*`, [victim.jid])
                    } else if (game.pyromaniacOiled.includes[victimId]) {
                        await whatsapp.sendMessage(groupId, `🐺 Les loups sont arrivé chez @${victim.jid.split('@')[0]}, ils ont juste trouvé une maison en cendre et sont reparti!\n Il était *[${victim.role}]*`, [victim.jid])
                    }
                    continue
                }

                if (game.prostituteProtected && game.prostituteProtected.includes(victimId)) {
                    if (game.players.find(p => p.role === "PROSTITUTE").jid === victimId) {
                        await whatsapp.sendMessage(groupId, `💄Après s'être faite écarter les jambes, la prostitué s'est faite écarter la cage thoracique \n` + `La prostitué est morte`)
                        victim.isDead = true
                        // await this.addUserPoints(game.players.find(p => p.role === "PROSTITUTE").jid, whatsapp, POINTS_LIST.prostituteProtected, "protection sexuelle", 0)
                    } else {
                        await whatsapp.sendMessage(groupId, `💄 La victime des loups était trop occupé à baiser pour ouvrir aux loups!\nPersonne n'est mort\n` + `+${POINTS_LIST.prostituteProtected} points pour la prostitué`)
                        await this.addUserPoints(game.players.find(p => p.role === "PROSTITUTE").jid, whatsapp, POINTS_LIST.prostituteProtected, "protection sexuelle", 0)
                    }

                } else if (game.doctorChoice && game.doctorChoice === victimId) {
                    await whatsapp.sendMessage(groupId, "les loups ont attaqué, \nmais leur victime a été sauvée par la médécine moderne! 💉\n" + `+${POINTS_LIST.doctorProtected} points pour le docteur`)
                    await this.addUserPoints(game.players.find(p => p.role === "DOCTOR").jid, whatsapp, POINTS_LIST.doctorProtected, "guérison médicinale", 0)
                } else if (game.witchHeal) {
                    await whatsapp.sendMessage(groupId, "les loups ont attaqué, \nmais leur victime a été protégée par magie! 🪄\n" + `+${POINTS_LIST.witchProtected} points pour la sorcière`)
                    await this.addUserPoints(game.players.find(p => p.role === "WITCH").jid, whatsapp, POINTS_LIST.witchProtected, "protection magique", 0)
                } else {
                    if (victim.role === "HUNTER") {
                        if (counts[victimId] == 1 && Math.random() < 0.2) {
                            wolf.isDead = true
                            this.saveGames(this.games)
                            await whatsapp.sendMessage(groupId, `Le loup a visité le chasseur et a reçus une balle en argent dans la tête\n@${wolfjid.split('@')[0]} a été tué par le HUNTER`, [wolfjid])
                        } else {
                            victim.isDead = true
                            await whatsapp.sendMessage(groupId, `@${victimId.split('@')[0]} a été tué pendant la nuit! il était [${victim.role}]`, [victimId])
                            await this._hunterRant(groupId, victim, whatsapp)
                            wasHunter = true; // Don't check win condition yet
                        }

                    } else {
                        if (wolf.role === "ALPHAWEREWOLF" && counts[victimId] == 1 && Math.random() > 0.4 && !game.alphaWerewolfHasConverted) {
                            victim.role = "WEREWOLF"
                            await whatsapp.sendMessage(wolf.jid, `Ta victime a été ~akumatisé~ eurh transformé en WEREWOLF`)
                            await whatsapp.sendMessage(victim.jid, `vous avait été ~akumatisé~ eurh transformé en WEREWOLF`)
                            game.alphaWerewolfHasConverted = true
                        } else {
                            victim.isDead = true
                            await whatsapp.sendMessage(groupId, `@${victimId.split('@')[0]} a été tué pendant la nuit! il était [${victim.role}]`, [victimId])

                        }
                    }
                    if (victim.lover && victim.isDead) {
                        const partner = game.players.find(p => p.jid === victim.lover)
                        if (partner && !partner.isDead) {
                            partner.isDead = true
                            await whatsapp.sendMessage(groupId, `💔 *${partner.name}* (@${partner.jid.split('@')[0]}) est mort de chagrin suite à la perte de son amoureux. Il était un ${partner.role}`, [partner.jid])
                            if (partner.role === "HUNTER") {
                                await this._hunterRant(groupId, partner, whatsapp)
                                wasHunter = true; // Don't check win condition yet
                            }
                            if (partner.role === "WEREWOLF" || partner.role === "ALPHAWEREWOLF") {
                                await whatsapp.sendMessage(groupId, "💘 Le loup est mort grace à cupidon " + `+${POINTS_LIST.cupidonlinkWolf} points pour lui`)
                                await this.addUserPoints(game.players.find(p => p.role === "CUPID").jid, whatsapp, POINTS_LIST.cupidonlinkWolf, "Cupidon lie le loup", 0)
                            }

                        }
                    } else if (wolf.lover && wolf.isDead) {
                        const partner = game.players.find(p => p.jid === wolf.lover)
                        if (partner && !partner.isDead) {
                            partner.isDead = true
                            await whatsapp.sendMessage(groupId, `💔 *${partner.name}* (@${partner.jid.split('@')[0]}) est mort de chagrin suite à la perte de son amoureux. Il était un ${partner.role}`, [partner.jid])
                            if (partner.role === "HUNTER") {
                                await this._hunterRant(groupId, partner, whatsapp)
                                wasHunter = true; // Don't check win condition yet
                            }
                            if (partner.role === "WEREWOLF" || partner.role === "ALPHAWEREWOLF") {
                                await whatsapp.sendMessage(groupId, "💘 Le loup est mort grace à cupidon " + `+${POINTS_LIST.cupidonlinkWolf} points pour lui`)
                                await this.addUserPoints(game.players.find(p => p.role === "CUPID").jid, whatsapp, POINTS_LIST.cupidonlinkWolf, "Cupidon lie le loup", 0)
                            }

                        }
                    }

                }
            }


            this.saveGames(this.games)
            if (wasHunter) {
                return;
            } if (!wasVictim) {
                await whatsapp.sendMessage(groupId, "☀️ Le jour se lève... \npersonne n'est mort cette nuit.")
            }
        } catch (error) {
            await whatsapp.sendMessage("237676073559@s.whatsapp.net", "Erreur dans resolve night négro \n\n" + error.toString() + '\nLe dernier Message :')
            console.log(error)
        }


        const { name: result, players: winners } = this.checkWin(game)
        if (result) {
            await whatsapp.sendMessage(groupId, `🏆 Partie terminée! \n*${result}* gagnent!`)
            const names = game.players.map((p, i) => (winners.some(w => w.jid === p.jid) ? '🏆' : '💩') + ` *${p.name}* (@${p.jid.split('@')[0]}) ` + (!p.isDead ? `😀` : `☠️`) + ' [' + p.role + "]").join("\n")
            const mentions = game.players.map((p, i) => p.jid)
            await whatsapp.sendMessage(groupId, "Joueurs :\n\n " + names, mentions)
            await whatsapp.sendMessage(groupId, `envoie *"!werewolve"* pour rejouer`)
            delete this.games[groupId]
            this.saveGames(this.games)
            return
        }

        await this.startDay(groupId, whatsapp)
    }

    async startDay(groupId, whatsapp) {
        const game = this.games[groupId]
        if (!game) return
        game.state = "DAY"
        game.votes = {}
        game.playerChangeVoteCounts = {}
        this.saveGames(this.games)

        const dayDuration = Math.min(10 * 60 * 1000, Math.max(3 * 60 * 1000, game.players.filter(p => !p.isDead).length * 60 * 1000))

        let seconds = 0
        await whatsapp.sendMessage(groupId, "🌞 Jour: Discutez et votez avec *!vote  _numéro victime_*\nVous avez " + (dayDuration / (60 * 1000)) + " minutes")
        const names = game.players.map((p, i) => `[${i + 1}] - *${p.name}* (@${p.jid.split('@')[0]}) ` + (!p.isDead ? `😀` : `☠️ [${p.role}]`)).join("\n")
        const mentions = game.players.map((p, i) => p.jid)
        await whatsapp.sendMessage(groupId, "Joueurs :\n\n " + names, mentions)

        timers[groupId][0] = setTimeout(async () => {
            this.resolveVotes(groupId, whatsapp)
        }, dayDuration)

        seconds = ((dayDuration) / (2 * 1000))
        timers[groupId][1] = setTimeout(async () => {
            await this.sendTips(groupId, whatsapp)
            await whatsapp.sendMessage(groupId, "*⏱️ " + (seconds < 120 ? seconds + " secondes" : (seconds / 60).toPrecision(2) + " minutes") + " restante avant le coucher du soleil!*")
            await whatsapp.sendMessage(groupId, "Joueurs :\n\n " + names, mentions)
        }, dayDuration / 2)

        seconds = ((dayDuration) / (5 * 1000))
        timers[groupId][2] = setTimeout(async () => {
            await whatsapp.sendMessage(groupId, "*⏱️ " + (seconds < 120 ? seconds + " secondes" : (seconds / 60).toPrecision(2) + " minutes") + "  restantes avant le coucher du soleil!*")
            await whatsapp.sendMessage(groupId, "Joueurs :\n\n " + names, mentions)
        }, (4 * dayDuration) / (5))

        seconds = ((dayDuration) / (10 * 1000))
        timers[groupId][3] = setTimeout(async () => {
            await this.sendTips(groupId, whatsapp)
            await whatsapp.sendMessage(groupId, "*📩 Il est plus que temps de voter!*")
            await whatsapp.sendMessage(groupId, "*⏱️ " + (seconds < 120 ? seconds + " secondes" : (seconds / 60).toPrecision(2) + " minutes") + " restantes avant le coucher du soleil!*")
            await whatsapp.sendMessage(groupId, "Joueurs :\n\n " + names, mentions)
        }, (9 * dayDuration) / (10))

        if (seconds >= 60)
            timers[groupId][4] = setTimeout(async () => {
                await whatsapp.sendMessage(groupId, "*📩 Il est plus que temps de voter!*")
                await whatsapp.sendMessage(groupId, "*⏱️ 30 secondes restantes avant le coucher du soleil!*")
                await whatsapp.sendMessage(groupId, "Joueurs :\n\n " + names, mentions)
            }, dayDuration - (1000 * 30))
    }

    async resolveVotes(groupId, whatsapp) {
        const game = this.games[groupId]
        if (!game) return

        // At start of resolveVotes:
        if (game.votesStopped) {
            const mayor = game.players.find(p => p.role === "MAYOR")
            await whatsapp.sendImage(groupId, path.join(IMAGE_FILE, "mayor.jpg"), "⚖️ Le vote a été annulé par le Maire @" + mayor.jid.split('@')[0], [mayor.jid])
            game.votesStopped = false
            // Then proceed to night
            await this.startNight(groupId, whatsapp)
            return
        }

        const counts = {}
        for (const voter in game.votes) {
            const target = game.votes[voter]
            counts[target] = (counts[target] || 0) + 1
        }

        let victimId = null
        let maxVotes = 0
        for (const target in counts) {
            if (counts[target] > maxVotes) {
                victimId = target
                maxVotes = counts[target]
            }
        }

        let TANNERWASVOTED = false;

        if (victimId) {
            const victim = game.players.find(p => p.jid === victimId)
            victim.isDead = true
            await whatsapp.sendMessage(groupId, `⚖️ Le village a exécuté @${victimId.split('@')[0]}. C'était un *${victim.role}*.`, [victimId])
            if (victim.role === "WEREWOLF" || victim.role === "ALPHAWEREWOLF") {
                const wolveVoters = []
                for (const voter in game.votes) {
                    const target = game.votes[voter]
                    if (victim.jid === target && victim.jid !== voter) {
                        const _voter = game.players.find(p => p.jid === voter)
                        await this.addUserPoints(_voter.jid, whatsapp, POINTS_LIST.votedWolf, 'voté un loup', 0)
                        wolveVoters.push(_voter)
                    }
                }
                await whatsapp.sendMessage(groupId, `⚖️ Les villageois suivant ont *voté un loup à mort,* donc recoivent *+${POINTS_LIST.votedWolf} points*:\n\n` +
                    `` + wolveVoters.map(_wv => `*${_wv.name}* (@${_wv.jid.split('@')[0]})`).join('\n')
                    , wolveVoters.map(w => w.jid))
            } else {
                const wolveVoters = []
                for (const voter in game.votes) {
                    const target = game.votes[voter]
                    if (victim.jid === target) {
                        const _voter = game.players.find(p => p.jid === voter)
                        await this.addUserPoints(_voter.jid, whatsapp, POINTS_LIST.votedInnocent, 'Voté un innocent', 0)
                        wolveVoters.push(_voter)
                    }
                }
                await whatsapp.sendMessage(groupId, `⚖️ Les villageois suivant ont *voté un innocent à mort,* donc sont déduis *${POINTS_LIST.votedInnocent} points*:\n\n` +
                    `` + wolveVoters.map(_wv => `*${_wv.name}* (@${_wv.jid.split('@')[0]})`).join('\n')
                    , wolveVoters.map(w => w.jid))
            }

            if (victim.role === "HUNTER") {
                await this._hunterRant(groupId, victim, whatsapp)
                return; // Don't check win condition yet
            }
            if (victim.lover) {
                const partner = game.players.find(p => p.jid === victim.lover)
                if (partner && !partner.isDead) {
                    partner.isDead = true
                    await whatsapp.sendMessage(groupId, `💔 *${partner.name}* (@${partner.jid.split('@')[0]}) est mort de chagrin suite à la perte de son amoureux. Il était un ${partner.role}`, [partner.jid])
                    if (partner.role === "HUNTER") {
                        await this._hunterRant(groupId, partner, whatsapp)
                        return; // Don't check win condition yet
                    }
                    if (partner.role === "WEREWOLF" || partner.role === "ALPHAWEREWOLF") {
                        await whatsapp.sendMessage(groupId, "💘 Le loup est mort grace à cupidon " + `+${POINTS_LIST.cupidonlinkWolf} points pour lui`)
                        await this.addUserPoints(game.players.find(p => p.role === "CUPID").jid, whatsapp, POINTS_LIST.cupidonlinkWolf, "Cupidon lie le loup", 0)
                    }
                }
            }


            // Vérifier si la victime est le Tanner
            if (victim.role === "TANNER") {
                // await whatsapp.sendMessage(groupId, `🎭 Le village a exécuté @${victimId.split('@')[0]}. C'était un *[${victim.role}]*.`, [victimId])
                await whatsapp.sendMessage(groupId, `🎉 *Bande de fous !!!*\nLe Tanner a gagné ! Il a réussi à se faire voter par le village.`)
                await this.addUserPoints(victim.jid, whatsapp, POINTS_LIST.votedAsTanner, 'mort comme tanneur', 0)
                // Terminer la partie - le Tanner gagne seul
                TANNERWASVOTED = true

            }

        } else {
            await whatsapp.sendMessage(groupId, "⚖️ Personne n'a été exécuté aujourd'hui.")
        }

        const nonVoters = []
        game.players.forEach(async p => {
            if (!Object.keys(game.votes).some(_voter => _voter === p.jid) && !p.isDead) {
                nonVoters.push(p)
                await this.addUserPoints(p.jid, whatsapp, POINTS_LIST.didntVote, 'n\'a pas voté', 0)
            }
        });
        await whatsapp.sendMessage(groupId, `⚖️ Les villageois suivant *n'ont pas voté,* donc sont déduis *${POINTS_LIST.didntVote} points*:\n\n` +
            `` + nonVoters.map(_wv => `*${_wv.name}* (@${_wv.jid.split('@')[0]})`).join('\n')
            , nonVoters.map(w => w.jid))

        this.saveGames(this.games)

        const { name: result, players: winners } = this.checkWin(game)
        if (result) {
            await whatsapp.sendMessage(groupId, `🏆 Partie terminée! \n*${result}* gagnent!`)
            const names = game.players.map((p, i) => (winners.some(w => w.jid === p.jid) ? '🏆' : '💩') + ` *${p.name}* (@${p.jid.split('@')[0]}) ` + (!p.isDead ? `😀` : `☠️`) + ' [' + p.role + "]").join("\n")
            const mentions = game.players.map((p, i) => p.jid)
            await whatsapp.sendMessage(groupId, "Joueurs :\n\n " + names, mentions)
            await whatsapp.sendMessage(groupId, `envoie *"!werewolve"* pour rejouer`)
            delete this.games[groupId]
            this.saveGames(this.games)
            return
        } else if (TANNERWASVOTED) {
            const victim = game.players.find(p => p.jid === victimId)
            await whatsapp.sendMessage(groupId, `🏆 Partie terminée! \nLe *TANNEUR* gagne!`)
            const names = game.players.map((p, i) => (victim.jid === p.jid ? '🏆' : '💩') + ` *${p.name}* (@${p.jid.split('@')[0]}) ` + (!p.isDead ? `😀` : `☠️`) + ' [' + p.role + "]").join("\n")
            const mentions = game.players.map((p, i) => p.jid)
            await whatsapp.sendMessage(groupId, "Joueurs :\n\n " + names, mentions)
            await whatsapp.sendMessage(groupId, `envoie *"!werewolve"* pour rejouer`)
            delete this.games[groupId]
            this.saveGames(this.games)
            return
        }

        this.startNight(groupId, whatsapp)
    }

    //////////////////////////////////////////               ACTIONS                     ////////////////////////////////////////////

    async wolfKill(groupId, wolfJid, targetJid, whatsapp) {
        const game = this.games[groupId]
        if (!game || game.state !== "NIGHT") return

        const wolf = game.players.find(p => p.jid === wolfJid)
        if (wolf.role !== "WEREWOLF" && wolf.role !== "ALPHAWEREWOLF") {
            await whatsapp.sendMessage(wolfJid, "⚠️ Tu n'es pas loup.")
            return
        }
        if (!wolf || wolf.isDead) {
            await whatsapp.sendMessage(wolfJid, "⚠️ Tu n'es pas autorisé à tuer.")
            return
        }

        const target = game.players.find(p => p.jid === targetJid && !p.isDead)

        if (!target) {
            await whatsapp.sendMessage(wolfJid, "⚠️ Cible invalide.")
            return
        }

        if (target.role.includes("WEREWOLF")) {
            await whatsapp.sendMessage(wolfJid, "⚠️ Tu ne peux pas tuer un loup 🐺.")
            return
        }

        if (target.jid === wolf.jid) {
            await whatsapp.sendMessage(wolfJid, "⚠️ Tu ne peux pas te tuer ékié 😑.")
            return
        }

        game.wolfChoices[wolfJid] = targetJid
        this.saveGames(this.games)

        await whatsapp.sendMessage(groupId, `🐺 Les loups-garous hurlent à la lune.`)
        await whatsapp.sendMessage(wolfJid, `✅ Tu as sélectionné *${target.name}* (@${target.jid.split('@')[0]}) comme ta victime.`, [target.jid])
    }

    async seerInspect(groupId, targetJid, whatsapp) {
        const game = this.games[groupId]
        if (!game || game.state !== "NIGHT") return

        const seer = game.players.find(p => p.jid === whatsapp.sender)
        if (seer.role === "MADMAN") {
            this.handleMadManAction(groupId, whatsapp.sender, "SEER", targetJid, whatsapp)
            return
        }

        if (!seer || seer.role !== "SEER" || seer.isDead) {
            await whatsapp.sendMessage(whatsapp.sender, "⚠️ Tu ne peux pas utiliser la capacité de Voyante.")
            return
        }

        const target = game.players.find(p => p.jid === targetJid && !p.isDead)
        if (!target || target.jid === seer.jid) {
            await whatsapp.sendMessage(whatsapp.sender, "⚠️ Cible invalide.")
            return
        }

        if (game.seerChoice) {
            await whatsapp.sendMessage(whatsapp.sender, `⚠️ Tu ne peux utiliser ta capacité qu'une fois par nuit`)
            return
        }

        game.seerChoice = targetJid
        this.saveGames(this.games)

        const result = (target.role.includes("WEREWOLF") ||
            (game.seerFakeWolves && game.seerFakeWolves.includes(target.jid))) ?
            "un 🐺 Loup-Garou" : "pas un Loup-Garou";
        await whatsapp.sendMessage(seer.jid, `🔮 Résultat: \n*${target.name}* (@${target.jid.split('@')[0]}) est ${result}.`, [target.jid])
    }

    async doctorSave(groupId, targetJid, whatsapp) {
        const game = this.games[groupId]
        if (!game || game.state !== "NIGHT") return


        const doctor = game.players.find(p => p.jid === whatsapp.sender)
        if (!doctor || doctor.role !== "DOCTOR" || doctor.isDead) {
            await whatsapp.sendMessage(whatsapp.sender, "⚠️ Tu ne peux pas utiliser la capacité de Docteur.")
            return
        }

        const target = game.players.find(p => p.jid === targetJid && !p.isDead)
        if (!target) {
            await whatsapp.sendMessage(whatsapp.sender, "⚠️ Cible invalide.")
            return
        }

        if (target.jid === doctor.jid) {
            await whatsapp.sendMessage(whatsapp.sender, "⚠️ Tu ne peux pas te sauver toi même, sale égoiste!")
            return
        }

        if (game.doctorChoice) {
            await whatsapp.sendMessage(whatsapp.sender, `⚠️ ${game.doctorChoice} n'est plus protégé`)
        }

        game.doctorChoice = targetJid
        this.saveGames(this.games)
        await whatsapp.sendMessage(doctor.jid, `💉 Tu as choisi de protéger *${target.name}* (@${target.jid.split('@')[0]}) cette nuit.`, [target.jid])
    }

    async _hunterRant(groupId, hunter, whatsapp) {
        const game = this.games[groupId]
        if (!game) return

        game.pendingHunter = hunter.jid;
        game.hunterTimeout = Date.now();

        await whatsapp.sendMessage(groupId, `⚖️ Veillez patienter pendant que le HUNTER choisis sa cible ☠️`)

        await whatsapp.sendMessage(hunter.jid, "☠️ Tu es mourant. \nEnvoie *!shoot  _numéro victime_* dans les 45 secondes pour emmener quelqu'un avec toi!");
        const names = game.players.map((p, i) => `[${i + 1}] - *${p.name}* (@${p.jid.split('@')[0]}) ` + (!p.isDead ? `😀` : `☠️ [${p.role}]`)).join("\n")
        const mentions = game.players.map((p, i) => p.jid)
        await whatsapp.sendMessage(hunter.jid, "Joueurs :\n\n " + names, mentions)

        // Set hunter timeout

        timers[groupId][0] = setTimeout(async () => {
            await whatsapp.sendImage(groupId, path.join(IMAGE_FILE, "sunrise.jpg"), "☀️ Le jour se lève...")
            await whatsapp.sendMessage(groupId, `@${hunter.jid.split('@')[0]} a été tué pendant la nuit!\n\nMais... c'était un Chasseur 🏹`, [hunter.jid])

            if (!game.hunterTarget)
                await whatsapp.sendMessage(groupId, "🏹 Le Chasseur n'a abattu personne avant de mourir.");
            else {
                await whatsapp.sendMessage(groupId, `🏹 Le Chasseur a abattu *${game.hunterTarget.name}* (@${game.hunterTarget.jid.split('@')[0]}) en mourant! il était un [${game.hunterTarget.role}]`, [game.hunterTarget.jid])
                if (game.hunterTarget.role.includes("WEREWOLF")) {
                    await whatsapp.sendMessage(groupId, `🏹 Le Chasseur a abattu un Loup Garou, *+${POINTS_LIST.hunterKillsWolf} points*`)
                    await this.addUserPoints(hunter.jid, whatsapp, POINTS_LIST.hunterKillsWolf, "Chasseur tue un loup", 0)

                }
                if (game.hunterTarget.lover) {
                    const partner = game.players.find(p => p.jid === game.hunterTarget.lover)
                    if (partner && !partner.isDead) {
                        partner.isDead = true
                        await whatsapp.sendMessage(groupId, `💔 *${partner.name}* (@${partner.jid.split('@')[0]}) est mort de chagrin suite à la perte de son amoureux.`, [partner.jid])
                        if (partner.role.includes("WEREWOLF") || partner.role === "ALPHAWEREWOLF") {
                            await whatsapp.sendMessage(groupId, "💘 Le loup est mort grace à cupidon " + `+${POINTS_LIST.cupidonlinkWolf} points pour lui`)
                            await this.addUserPoints(game.players.find(p => p.role === "CUPID").jid, whatsapp, POINTS_LIST.cupidonlinkWolf, "Cupidon lie le loup", 0)
                        }
                    }
                }
            }
            game.hunterTarget = null;

            if (hunter.lover) {
                const partner = game.players.find(p => p.jid === hunter.lover)
                if (partner && !partner.isDead) {
                    partner.isDead = true
                    await whatsapp.sendMessage(groupId, `💔 *${partner.name}* (@${partner.jid.split('@')[0]}) est mort de chagrin suite à la perte de son amoureux.`, [partner.jid])
                    if (partner.role.includes("WEREWOLF") || partner.role === "ALPHAWEREWOLF") {
                        await whatsapp.sendMessage(groupId, "💘 Le loup est mort grace à cupidon " + `+${POINTS_LIST.cupidonlinkWolf} points pour lui`)
                        await this.addUserPoints(game.players.find(p => p.role === "CUPID").jid, whatsapp, POINTS_LIST.cupidonlinkWolf, "Cupidon lie le loup", 0)
                    }
                    if (partner.role === "HUNTER") {
                        await this._hunterRant(groupId, partner, whatsapp)
                        return; // Don't check win condition yet
                    }
                }

            }
            this.saveGames(this.games)

            const { name: result, players: winners } = this.checkWin(game)
            if (result) {
                await whatsapp.sendMessage(groupId, `🏆 Partie terminée! \n*${result}* gagnent!`)
                const names = game.players.map((p, i) => (winners.some(w => w.jid === p.jid) ? '🏆' : '💩') + ` *${p.name}* (@${p.jid.split('@')[0]}) ` + (!p.isDead ? `😀` : `☠️`) + ' [' + p.role + "]").join("\n")
                const mentions = game.players.map((p, i) => p.jid)
                await whatsapp.sendMessage(groupId, "Joueurs :\n\n " + names, mentions)
                await whatsapp.sendMessage(groupId, `envoie *"!werewolve"* pour rejouer`)
                delete this.games[groupId]
                this.saveGames(this.games)
                return
            }

            await this.startDay(groupId, whatsapp)
        }, 45 * 1000);

        this.saveGames(this.games)
    }

    async hunterShoot(groupId, targetJid, whatsapp) {
        const game = this.games[groupId]
        if (!game || game.pendingHunter !== whatsapp.sender) return
        const target = game.players.find(p => p.jid === targetJid && !p.isDead)
        if (!target) {
            await whatsapp.sendMessage(whatsapp.sender, "⚠️ Cible invalide.")
            return
        }
        target.isDead = true
        game.pendingHunter = null
        game.hunterTarget = target
        this.saveGames(this.games)
        await whatsapp.sendMessage(whatsapp.sender, "👍 Ta cible a été abattue avec succès.")
    }

    async witchHeal(groupId, whatsapp) {
        const game = this.games[groupId]
        if (!game) return
        const witch = game.players.find(p => p.jid === whatsapp.sender)
        if (!witch || witch.role !== "WITCH" || !game.witchHealAvailable) return
        game.witchHeal = true
        game.witchHealAvailable = false
        this.saveGames(this.games)
        await whatsapp.sendMessage(witch.jid, "🧪 Tu as choisi de soigner la victime de cette nuit.")
    }

    async witchPoison(groupId, targetJid, whatsapp) {
        const game = this.games[groupId]
        if (!game) return
        const witch = game.players.find(p => p.jid === whatsapp.sender)
        if (!witch || witch.role !== "WITCH" || !game.witchPoisonAvailable) return
        const target = game.players.find(p => p.jid === targetJid && !p.isDead)
        if (!target || target.jid === witch.jid) return await whatsapp.sendMessage(witch.jid, "⚠️ Cible invalide.")
        target.isDead = true
        game.witchPoisonAvailable = false
        this.saveGames(this.games)
        await whatsapp.sendMessage(groupId, `🧪 La Sorcière a empoisonné *${target.name}* (@${target.jid.split('@')[0]}) pendant la nuit!`, [targetJid])
        await whatsapp.sendMessage(witch.jid, `🧪 Tu as empoisonné *${target.name}* (@${target.jid.split('@')[0]}) !`, [targetJid])
        if (target.role.includes("WEREWOLF")) {
            await whatsapp.sendMessage(groupId, `🧪 La Sorcière a empoisonné un Loup Garou, *+${POINTS_LIST.witchPoisonWolf} points*`)
            await this.addUserPoints(witch.jid, whatsapp, POINTS_LIST.witchPoisonWolf, "sorcière tue un loup", 0)
        }
        if (target.role === "HUNTER") {
            await this._hunterRant(groupId, target, whatsapp)
            return; // Don't check win condition yet
        }
        if (target.lover) {
            const partner = game.players.find(p => p.jid === target.lover)
            if (partner && !partner.isDead) {
                partner.isDead = true
                await whatsapp.sendMessage(groupId, `💔 *${partner.name}* (@${partner.jid.split('@')[0]}) est mort de chagrin suite à la perte de son amoureux. Il était un ${partner.role}`, [partner.jid])
                if (partner.role === "HUNTER") {
                    await this._hunterRant(groupId, partner, whatsapp)
                    return; // Don't check win condition yet
                }
                if (partner.role === "WEREWOLF" || partner.role === "ALPHAWEREWOLF") {
                    await whatsapp.sendMessage(groupId, "💘 Le loup est mort grace à cupidon " + `+${POINTS_LIST.cupidonlinkWolf} points pour lui`)
                    await this.addUserPoints(game.players.find(p => p.role === "CUPID").jid, whatsapp, POINTS_LIST.cupidonlinkWolf, "Cupidon lie le loup", 0)
                }
            }
        }
    }

    async cupidPair(groupId, jid1, jid2, whatsapp) {
        const game = this.games[groupId]
        const cupid = game.players.find(p => p.jid === whatsapp.sender)
        if (!cupid || cupid.role !== "CUPID") return
        const p1 = game.players.find(p => p.jid === jid1)
        const p2 = game.players.find(p => p.jid === jid2)
        if (game.nights !== 1) return await whatsapp.sendMessage(cupid.jid, "⚠️ Tu ne peux lier que 2 amoureux la première nuit.\nAprès la première nuit tu n'es qu'un simple villageois")
        if (!p1 || !p2) return await whatsapp.sendMessage(cupid.jid, "⚠️ Amoureux invalides.")
        p1.lover = jid2
        p2.lover = jid1
        this.saveGames(this.games)
        await whatsapp.sendMessage(cupid.jid, `❤️ Tu as lié @${jid1.split('@')[0]} et @${jid2.split('@')[0]} comme amoureux.`, [jid1, jid2])
        await whatsapp.sendMessage(jid1, "❤️ Tu es amoureux de @" + jid2.split('@')[0], [jid2])
        await whatsapp.sendMessage(jid2, "❤️ Tu es amoureux de @" + jid1.split('@')[0], [jid1])
    }

    async prostituteVisit(groupId, prostituteJid, targetJid, whatsapp) {
        const game = this.games[groupId]
        if (!game || game.state !== "NIGHT") return

        const prostitute = game.players.find(p => p.jid === prostituteJid)
        if (prostitute.role === "MADMAN") {
            this.handleMadManAction(groupId, prostituteJid, "PROSTITUTE", targetJid, whatsapp)
            return
        }

        if (!prostitute || prostitute.role !== "PROSTITUTE" || prostitute.isDead) {
            await whatsapp.sendMessage(prostituteJid, "⚠️ Tu ne peux pas visiter.")
            return
        }

        if (game.prostituteChoice) {
            await whatsapp.sendMessage(prostituteJid, "⚠️ Tu ne peux plus visiter, ékié!\n2 Coups en 1 soir?.")
            return
        }

        const target = game.players.find(p => p.jid === targetJid && !p.isDead)
        if (!target || target.jid === prostituteJid) {
            await whatsapp.sendMessage(prostituteJid, "⚠️ Cible invalide.")
            return
        }

        game.prostituteChoice = targetJid

        await whatsapp.sendMessage(prostituteJid, `✅ Tu as visité *${target.name}* (@${target.jid.split('@')[0]}).`, [target.jid])

        // If visited a wolf, prostitute dies
        if (target.role.includes("WEREWOLF")) {
            prostitute.isDead = true
            await whatsapp.sendMessage(prostituteJid, "⚠️ Vous avez visité un loup-garou et êtes morte!")
            await whatsapp.sendImage(groupId, path.join(IMAGE_FILE, "death2.jpg"), `💄 La Prostituée a visité un loup-garou et est morte!`)

        } else {
            // Mark both as protected from wolf attack
            game.prostituteProtected = [prostituteJid, targetJid]
            // Mark prostitute as appearing as wolf to seer
            game.seerFakeWolves = game.seerFakeWolves || []
            game.seerFakeWolves.push(prostituteJid)
        }
        this.saveGames(this.games)

    }

    // Actions pour Serial Killer
    async serialKill(groupId, killerJid, targetJid, whatsapp) {
        const game = this.games[groupId]
        if (!game || game.state !== "NIGHT") return

        const killer = game.players.find(p => p.jid === killerJid)
        if (!killer || killer.role !== "SERIALKILLER" || killer.isDead) {
            await whatsapp.sendMessage(killerJid, "⚠️ Tu n'es pas autorisé à tuer.")
            return
        }

        const target = game.players.find(p => p.jid === targetJid && !p.isDead)
        if (!target) {
            await whatsapp.sendMessage(killerJid, "⚠️ Cible invalide.")
            return
        }

        game.serialKillerChoice = targetJid
        this.saveGames(this.games)

        await whatsapp.sendMessage(killerJid, `✅ Tu as choisi de tuer *${target.name}* (@${target.jid.split('@')[0]}) cette nuit.`, [target.jid])
    }

    // Actions pour Pyromaniac
    async pyromaniacAction(groupId, pyroJid, action, targetJid, whatsapp) {
        const game = this.games[groupId]
        if (!game || game.state !== "NIGHT") return

        const pyro = game.players.find(p => p.jid === pyroJid)
        if (!pyro || pyro.role !== "PYROMANIAC" || pyro.isDead) {
            await whatsapp.sendMessage(pyroJid, "⚠️ Tu n'es pas autorisé à utiliser cette action.")
            return
        }

        if (action === 'oil') {
            const target = game.players.find(p => p.jid === targetJid && !p.isDead)
            if (!target) {
                await whatsapp.sendMessage(pyroJid, "⚠️ Cible invalide.")
                return
            }

            if (game.pyromaniacOiled.length >= 6) {
                await whatsapp.sendMessage(pyroJid, "⚠️ Tu as déjà trempé 6 joueurs, tu ne peux plus en tremper.")
                return
            }

            if (!game.pyromaniacOiled.includes(targetJid)) {
                game.pyromaniacOiled.push(targetJid)
                game.pyromaniacOiledTonight = true
                await whatsapp.sendMessage(targetJid, "💧 Tu as été trempé dans l'huile par le pyromane!")
                await whatsapp.sendMessage(pyroJid, `✅ Tu as trempé *${target.name}* dans l'huile.`, [target.jid])
            } else {
                await whatsapp.sendMessage(pyroJid, `❌ Tu l'as déjà trempé dans l'huile.`)
            }
        } else if (action === 'ignite') {
            game.pyromaniacChoice = 'ignite'
            await whatsapp.sendMessage(pyroJid, "✅ Tu as choisi d'immoler tous les joueurs trempés.")
        }

        this.saveGames(this.games)
    }

    // Gestion des actions du MadMan
    async handleMadManAction(groupId, madmanJid, action, targetJid, whatsapp) {
        const game = this.games[groupId]
        const madman = game.players.find(p => p.jid === madmanJid)

        if (!madman || madman.role !== "MADMAN" || madman.isDead) return

        // Selon le faux rôle, simuler l'action
        if (madman.fakeRole === "SEER") {
            // Donner une information fausse
            const target = game.players.find(p => p.jid === targetJid)
            const fakeResult = Math.random() > 0.5 ? "un 🐺 Loup-Garou" : "pas un Loup-Garou"
            await whatsapp.sendMessage(madmanJid, `🔮 Résultat: \n*${target.name}* est ${fakeResult}.`, [target.jid])
        } else if (madman.fakeRole === "PROSTITUTE") {
            // Simuler une visite sans effet
            const target = game.players.find(p => p.jid === targetJid)
            await whatsapp.sendMessage(madmanJid, `✅ Tu as visité *${target.name}*.`, [target.jid])
        } else if (madman.fakeRole === "MAYOR") {
            // Simuler une visite sans effet
            //const target = game.players.find(p => p.jid === targetJid)
            await whatsapp.sendMessage(madmanJid, "✋ Tu as arreté le vote pour aujourd'hui.\nIls ne le savent pas, mais leurs votes ne servent à rien 🤫")
        }
        // ... autres faux rôles ...
    }

    // New method for mayor action
    async mayorStopVote(groupId, mayorJid, whatsapp) {
        const game = this.games[groupId]
        if (!game) return


        const mayor = game.players.find(p => p.jid === mayorJid)
        if (mayor.role === "MADMAN") {
            this.handleMadManAction(groupId, whatsapp.sender, "MAYOR", null, whatsapp)
            return
        }


        if (!mayor || mayor.role !== "MAYOR" || mayor.isDead) {
            await whatsapp.sendMessage(mayorJid, "⚠️ Tu ne peux pas arrêter le vote.")
            return
        }

        if (!game.mayorPowerAvailable) {
            await whatsapp.sendMessage(mayorJid, "⚠️ Tu as déjà utilisé ton pouvoir.")
            return
        }


        if (game.mayorPowerAvailable) {
            game.mayorPowerAvailable = false;
            game.votesStopped = true;
            this.saveGames(this.games)
            await whatsapp.sendMessage(mayorJid, "✋ Tu as arreté le vote pour aujourd'hui.\nIls ne le savent pas, mais leurs votes ne servent à rien 🤫")
        }
    }

    async castVote(groupId, voterJid, targetJid, whatsapp) {
        const game = this.games[groupId]
        if (!game || game.state !== "DAY") return
        let user = getUser(voterJid)

        const voter = game.players.find(p => p.jid === voterJid)
        const target = game.players.find(p => p.jid === targetJid && !p.isDead)

        if (!voter || voter.isDead) {
            await whatsapp.reply("⚠️ Tu ne peux pas voter.")
            return
        }
        if (!target) {
            await whatsapp.reply("⚠️ Cible de vote invalide.")
            return
        }
        if (!target.jid === voterJid) {
            await whatsapp.reply("⚠️ Le suicide n'est jamais une solution.\n\nSi tu as besoin d'aide contacte un centre d'appel anti-suicide, ou tire un coup")
            return
        }



        if (game.playerChangeVoteCounts[voterJid] === 1 || game.playerChangeVoteCounts[voterJid] === 2) {
            if (user.points < POINTS_LIST.changeVotePenalty * game.playerChangeVoteCounts[voterJid]) {
                await whatsapp.reply(`Tu n'as pas assez de points`)
                return
            }
            await this.addUserPoints(voterJid, whatsapp, POINTS_LIST.changeVotePenalty, "Changé son vote", 0)
            await whatsapp.sendMessage(groupId, `⚠️ *${voter.name}* (@${voter.jid.split('@')[0]}), Changer votre vote vous coûte *-2 points,* changez encore et ça sera *4 points.*`, [voter.jid])
        } else if (game.playerChangeVoteCounts[voterJid] > 2) {
            await whatsapp.sendMessage(groupId, `🚫 *${voter.name}* (@${voter.jid.split('@')[0]}), Vous ne pouvez plus changer votre vote.*`, [voter.jid])
            return
        }

        game.votes[voterJid] = targetJid
        game.playerChangeVoteCounts[voterJid] = game.playerChangeVoteCounts[voterJid] ? 1 : game.playerChangeVoteCounts[voterJid] + 1
        this.saveGames(this.games)

        await whatsapp.sendMessage(groupId, `✅ *${voter.name}* (@${voter.jid.split('@')[0]}) a voté contre *${target.name}* (@${target.jid.split('@')[0]}).`, [voter.jid, target.jid])
    }


    /////////////////////////   UTILITIES

    async sendTips(groupId, whatsapp) {
        const game = this.games[groupId]
        if (!game) return
        const werewolfs = game.players.filter(p => p.role.includes("WEREWOLF") && !p.isDead) || []
        const wolfIndex = game.players.findIndex(p => p.jid === werewolfs[Math.floor(Math.random() * werewolfs.length)]?.jid)

        const tipType = Math.floor(Math.random() * 5)

        switch (tipType) {
            case 0:
                if (wolfIndex >= 0 && game.players.filter(p => !p.isDead).length > 9) {
                    const wolfIndexisEven = ((wolfIndex + 1) % 2 == 0)
                    await whatsapp.sendMessage(groupId, "*--- Indice ---*\n\nLe chiffre du loup est un chiffre *" + (wolfIndexisEven ? "paire*" : "inpaire*"))
                }
                break;
            case 1:
                if (wolfIndex >= 0) {
                    await whatsapp.sendMessage(groupId, "*--- Indice ---*\n\nLe nom que le loup à donné à une longeur de *" + Math.max(0, game.players[wolfIndex].name.length - Math.floor(Math.random() * 2) - 1) + " à " + game.players[wolfIndex].name.length + Math.floor(Math.random() * 4) + 1 + " charactères*")
                }
                break;
            case 2:
                const alpha = game.players.find(p => p.role === "ALPHAWEREWOLF" && !p.isDead)
                if (alpha) {
                    await whatsapp.sendMessage(groupId, "*--- Indice ---*\n\nLe loup alpha est présent et toujours vivant")
                } else {
                    await whatsapp.sendMessage(groupId, "*--- Indice ---*\n\nIl n'y a aucun loup alpha, ouf😤")
                }
                break;
            case 3:
                const good = game.players.find(p => (p.role === "CUPID" || p.role === "MAYOR" || p.role === "PROSTITUTE") && !p.isDead && Math.random() < 0.3)
                if (good) {
                    await whatsapp.sendMessage(groupId, `*--- Indice ---*\n\n@${good.jid.split('@')[0]} a une certaine lueuer qui émane de son couer.\nIl a l'air inoffensif`, [good.jid])
                }
                break;
            default:
                break;
        }
    }

    async sendPlayerList(groupId, whatsapp) {
        const game = this.games[groupId]
        if (!game) return

        //if (game.lastPlayerList > Date.now() - 30000) return
        const names = game.players.map((_p, i) => `[${i + 1}] - *${_p.name}* (@${_p.jid.split('@')[0]})` + (!_p.isDead ? `😀` : `Mort ☠️ [${_p.role}]`) + `\n   `).join("\n")
        const mentions = game.players.map((p, i) => p.jid)
        //game.lastPlayerList = Date.now()
        await whatsapp.sendMessage(groupId, "Joueurs :\n\n" + names, mentions)
        //this.saveGames(this.games)
    }

    async sendPlayerProfil(whatsapp) {
        let user = getUser(whatsapp.sender)
        if (user)
            await whatsapp.reply(`Profil de @${user.jid.split('@')[0]}\n\n` +
                `Nom : *${user.pushName.trim()}*\n` +
                `points : *${user.points} points*\n\n` +
                `Parties joués :\n ${Object.entries(user.games).map(([gameName, number]) => gameName + ' : *' + number + ' Parties joués*').join('\n')}`, [user.jid])
        //saveUser({ jid: playerJid, groups: [groupId], dateCreated: Date.now(), pushName: whatsapp.raw?.pushName, points: 100, pointsTransactions: [{ "nouveau joueur": 100 }] })
        else {
            await whatsapp.reply(`🚫 Tu n'es pas encore enregistré, joue d'abord à une partie!`)
        }
    }

    async stopGame(groupId, whatsapp) {
        const game = this.games[groupId]
        if (!game) return

        for (let i = 0; i < timers[groupId].length; i++) {
            const timer = timers[groupId][i];
            if (!timer) continue
            try {
                clearTimeout(timer)
            } catch (e) {
            }
        }

        await whatsapp.sendMessage(groupId, `🏆 Partie terminée!`)
        await whatsapp.sendMessage(groupId, `envoie *"!werewolve"* pour rejouer`)
        delete this.games[groupId]
        this.saveGames(this.games)
        return
    }

    async handleShortHand(groupId, playerJid, targetJid, whatsapp) {
        const game = this.games[groupId]
        if (!game) return

        const p = game.players.find(p => p.jid === whatsapp.sender)

        if (game.pendingHunter && game.pendingHunter == whatsapp.sender && p.role === "HUNTER" && !whatsapp.isGroup) {
            await this.hunterShoot(groupId, targetJid, whatsapp)
            return
        }

        if (game.state === "NIGHT") {
            if (whatsapp.isGroup) return
            if (p.role.includes("WEREWOLF")) {
                await this.wolfKill(groupId, playerJid, targetJid, whatsapp)
            } else if (p.role.includes("ALPHAWEREWOLF")) {
                await this.wolfKill(groupId, playerJid, targetJid, whatsapp)
            } else if (p.role === "SEER") {
                await this.seerInspect(groupId, targetJid, whatsapp)
            } else if (p.role === "DOCTOR") {
                await this.doctorSave(groupId, targetJid, whatsapp)
            } else if (p.role === "WITCH" && game.witchPoisonAvailable) {
                await this.witchPoison(groupId, targetJid, whatsapp)
            } else if (p.role === "PROSTITUTE") {
                await this.prostituteVisit(groupId, playerJid, targetJid, whatsapp)
            } else if (p.role === "SERIALKILLER") {
                await this.serialKill(groupId, playerJid, targetJid, whatsapp)
            } else if (p.role === "PYROMANIAC") {
                await this.pyromaniacAction(groupId, playerJid, 'oil', targetJid, whatsapp)
            } else if (p.role === "MADMAN") {
                await this.handleMadManAction(groupId, playerJid, null, targetJid, whatsapp)
            }
        } else if (game.state === "DAY") {
            if (whatsapp.isGroup) {
                await this.castVote(groupId, playerJid, targetJid, whatsapp)
            } else {

            }
        }

    }

    async checkIfCanSpeak(groupId, playerJid, whatsapp) {
        const game = this.games[groupId]
        if (!game) return

        let user = getUser(playerJid)

        const player = game.players.find(p => p.jid === playerJid)
        if (!player) return

        if (player.isDead) {
            if (game.state !== "NIGHT") {
                await this.addUserPoints(whatsapp.sender, whatsapp, -5, "talk when dead", 0)
                await whatsapp.reply('Les esprits ça parle uniquement la nuit!\nVous avez été déduis *-5 points*')
                await whatsapp.delete()
            } else {
                // await whatsapp.reply("⚠️ Le suicide n'est jamais une solution.\n\nSi tu as besoin d'aide contacte un centre d'appel anti-suicide, ou tire un coup")
                return
            }

        }
    }
}
