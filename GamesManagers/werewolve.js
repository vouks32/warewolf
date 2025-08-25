// gameManager.js
import fs from "fs"
import path from "path"
import RoleManager from "./werewolve-utils/roleManager.js"


const DATA_FILE = path.join(process.cwd(), "games/werewolves.json")
const IMAGE_FILE = path.join(process.cwd(), "images")

// --- Utilities ---
function delay(ms) {
    return new Promise(resolve => {
        setTimeout(() => {
            resolve();
        }, ms);
    });
}

function loadGames() {
    return {}
    if (!fs.existsSync(DATA_FILE)) return {}
    return JSON.parse(fs.readFileSync(DATA_FILE))
}

function saveGames(games) {
    let temp = { ...games }
    Object.entries(temp).forEach(arr => { temp[arr[0]].timer = false })
    fs.writeFileSync(DATA_FILE, JSON.stringify(temp, null, 2))
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

function checkWin(game) {
    const alive = game.players.filter(p => !p.isDead)
    const wolves = alive.filter(p => p.role === "WEREWOLF")
    const nonWolves = alive.filter(p => p.role !== "WEREWOLF")

    // Lovers win
    if (alive.length === 2 && alive[0].lover === alive[1].jid) {
        return "LOVERS"
    }
    if (wolves.length === 0) return "VILLAGERS"
    if (wolves.length >= nonWolves.length) return "WOLVES"
    return null
}

// --- Main Manager ---
export class WereWolvesManager {
    constructor() {
        this.games = loadGames()
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

    async createGame(groupId, whatsapp) {
        if (this.games[groupId]) {
            await whatsapp.reply("Une partie est déjà en cours wesh!")
            return
        }

        this.games[groupId] = {
            state: "WAITING_PLAYERS",
            players: [], // { jid, isPlaying, isDead, role }
            votes: {},   // daytime votes { voterJid: targetJid }
            wolfChoices: {}, // night kills { wolfJid: targetJid }
            seerChoice: null,
            doctorChoice: null,
            witchHealAvailable: true,
            witchPoisonAvailable: true,
            nights: 0,
            timer: null,
            prostituteChoice: null,  // Stores who the prostitute visited
            mayorPowerAvailable: true,  // Track if mayor can stop vote
            votesStopped: false
        }

        saveGames(this.games)

        await whatsapp.sendImage(groupId, path.join(IMAGE_FILE, "startgame.jpg"), "🎮 Nouvelle partie de loup garou, *Awoooo!😭* \nEnvoie *!play _pseudo_* pour rejoindre (3 minutes restantes).")

        this.games[groupId].timer = setTimeout(async () => {
            await this.startGame(groupId, whatsapp)
        }, 3 * 60 * 1000)
        setTimeout(async () => {
            await whatsapp.sendMessage(groupId, "🎮 1 minute restante pour rejoindre la partie! \nEnvoie *!play _pseudo_*")
        }, 2 * 60 * 1000)
        setTimeout(async () => {
            await whatsapp.sendMessage(groupId, "🎮 30 secondes restantes pour rejoindre la partie! \nEnvoie *!play _pseudo_*.")
        }, 30000 + (2 * 60 * 1000))
        setTimeout(async () => {
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

        game.players.push({ ids: whatsapp.ids, jid: playerJid, name, isPlaying: true, isDead: false, role: null })
        saveGames(this.games)

        const names = game.players.map((p, i) => `[${i + 1}] - *${p.name}* (@${p.jid.split('@')[0]}) ` + (!p.isDead ? `😀` : `☠️`)).join("\n")
        const mentions = game.players.map((p, i) => p.jid)

        await whatsapp.reply(`✅ Tu as rejoint!\n\nListe des joueurs:\n\n${names}`, mentions)

    }

    async startGame(groupId, whatsapp) {
        const game = this.games[groupId]
        if (!game || game.state !== "WAITING_PLAYERS") return

        if (game.players.length < 4) {
            await whatsapp.sendMessage(groupId, "⚠️ Pas assez de joueurs (faut au moins 4).\nC'est quoi? vous avez pas assez d'amis? \n*Jeu annulé.*")
            await whatsapp.sendMessage(groupId, `Envoyez *"!werewolve"* pour réessayer`)
            delete this.games[groupId]
            saveGames(this.games)
            return
        }

        game.state = "ASSIGNING_ROLES"
        //const roles = pickRandomRoles(game.players)

        const roles = RoleManager.generateRoles(game.players.length);

        if (!RoleManager.validateRoleDistribution(roles)) {
            await whatsapp.sendMessage(groupId, "⚠️ Une erreur lors de l'assignation des rôles, my bad ✋😐🤚. Jeu annulé.");
            await whatsapp.sendMessage(groupId, `envoyez encore *"!werewolve"* pour voir si je donne bien cette fois`)
            delete this.games[groupId]
            saveGames(this.games)
            return;
        }

        game.players.forEach((p, i) => (p.role = roles[i]))
        saveGames(this.games)

        // DM role to each player
        for (const p of game.players) {
            await whatsapp.sendMessage(p.jid, `🎭 Ton rôle est: *${p.role}*`)
            await delay(500)
        }

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

        saveGames(this.games)

        // DM prompts
        for (const p of game.players) {
            if (!p.isDead) {
                console.log("sending role to", p.name)
                await delay(1000)
                if (p.role === "WEREWOLF") {
                    await whatsapp.sendMessage(p.jid, "🐺 Nuit: \nEnvoie *!kill _<numéro victime>_* Pour voter qui vous allez dévorer.")
                } else if (p.role === "SEER") {
                    await whatsapp.sendMessage(p.jid, "🔮 Nuit: \nEnvoie *!see _<numéro victime>_* pour voir si il est un loup.")
                } else if (p.role === "DOCTOR") {
                    await whatsapp.sendMessage(p.jid, "💉 Nuit: \nEnvoie *!save _<numéro victime>_* pour protéger quelqu'un.")
                } else if (p.role === "WITCH" && (game.witchHealAvailable && game.witchPoisonAvailable)) {
                    await whatsapp.sendMessage(p.jid, "🧪 Nuit: \nEnvoie \n- *!heal* (et sauve la victime des loups pour ce soir) ou \n- *!poison _<numéro victime>_* (pour tuer quelqu'un).\n Tu ne peux le faire qu'une fois durant tout le jeu.")
                } else if (p.role === "CUPID" && game.nights == 1) {
                    await whatsapp.sendMessage(p.jid, "❤️ Nuit: \nChoisis deux amoureux: *!love _<numéro 1ère victime>_ _<numéro 2nd victime>_* (C'est la seule chance que tu as de lier, après cette occasion tu es un simple villageois)")
                } else if (p.role === "PROSTITUTE") {
                    await whatsapp.sendMessage(p.jid, "💄 Nuit: \nEnvoie *!visit <numéro client>* ou *<numéro client>* pour visiter quelqu'un.")
                } else if (p.role === "MAYOR") {
                    await whatsapp.sendMessage(p.jid, "🤵 Tu ne peux rien faire la nuit.\nMais en journée tu peux stopper les votes en envoyant *!stopvote*")
                } else {
                    await whatsapp.sendMessage(p.jid, "😴 Nuit: \nDors paisiblement.")
                }
                if (p.role !== "VILLAGER" && p.role !== "HUNTER" && p.role !== "MAYOR") {
                    if ((p.role === "WITCH" && (!game.witchPoisonAvailable))) return
                    if ((p.role === "CUPID" && game.nights !== 1)) return
                    await delay(1000)
                    const names = game.players.map((_p, i) => `[${i + 1}] - *${_p.name}* (@${_p.jid.split('@')[0]}) ` + (!_p.isDead ? ((p.role === "WEREWOLF" && _p.role === "WEREWOLF") ? `🐺` : `😀`) : `☠️`)).join("\n")
                    const mentions = game.players.map((p, i) => p.jid)
                    await whatsapp.sendMessage(p.jid, "Joueurs :\n\n" + names, mentions)
                }
            }
        }

        await whatsapp.sendImage(groupId, path.join(IMAGE_FILE, "nightfall.jpg"), "🌙 La nuit est tombée... \nSeules les prostituées rodent.... Du moins... c'est ce qu'elles pensent, \n\nVous avez 3 minutes")

        // Timer ends night
        game.timer = setTimeout(async () => {
            await this.resolveNight(groupId, whatsapp)
        }, 90 * 1000)
        setTimeout(async () => {
            await whatsapp.reply("🎮 60 secondes restante avant le lever du soleil!")
        }, 30 * 1000)
        setTimeout(async () => {
            await whatsapp.reply("🎮 30 secondes restantes avant le lever du soleil!")
        }, 60 * 1000)
        setTimeout(async () => {
            await whatsapp.reply("🎮 15 secondes restantes avant le lever du soleil!")
        }, 75 * 1000)
    }

    async wolfKill(groupId, wolfJid, targetJid, whatsapp) {
        const game = this.games[groupId]
        if (!game || game.state !== "NIGHT") return

        const wolf = game.players.find(p => p.jid === wolfJid)
        if (!wolf || wolf.role !== "WEREWOLF" || wolf.isDead) {
            await whatsapp.sendMessage(wolfJid, "⚠️ Tu n'es pas autorisé à tuer.")
            return
        }

        const target = game.players.find(p => p.jid === targetJid && !p.isDead)

        if (!target) {
            await whatsapp.sendMessage(wolfJid, "⚠️ Cible invalide.")
            return
        }

        if (target.role === "WEREWOLF") {
            await whatsapp.sendMessage(wolfJid, "⚠️ Tu ne peux pas tuer un loup 🐺.")
            return
        }

        if (target.jid === wolf.jid) {
            await whatsapp.sendMessage(wolfJid, "⚠️ Tu ne peux pas te tuer😑.")
            return
        }

        game.wolfChoices[wolfJid] = targetJid
        saveGames(this.games)

        await whatsapp.sendMessage(groupId, `🐺 Les loups-garous hurlent à la lune.`)
        await whatsapp.sendMessage(wolfJid, `✅ Tu as sélectionné *${target.name}* (@${target.jid.split('@')[0]}) comme ta victime.`, [target.jid])
    }

    async seerInspect(groupId, targetJid, whatsapp) {
        const game = this.games[groupId]
        if (!game || game.state !== "NIGHT") return

        const seer = game.players.find(p => p.jid === whatsapp.sender)
        if (!seer || seer.role !== "SEER" || seer.isDead) {
            await whatsapp.sendMessage(whatsapp.sender, "⚠️ Tu ne peux pas utiliser la capacité de Voyante.")
            return
        }

        const target = game.players.find(p => p.jid === targetJid && !p.isDead)
        if (!target) {
            await whatsapp.sendMessage(whatsapp.sender, "⚠️ Cible invalide.")
            return
        }

        if (game.seerChoice) {
            await whatsapp.sendMessage(whatsapp.sender, `⚠️ Tu ne peux utiliser ta capacité qu'une fois par nuit`)
            return
        }

        game.seerChoice = targetJid
        saveGames(this.games)

        const result = (target.role === "WEREWOLF" ||
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

        if (game.doctorChoice) {
            await whatsapp.sendMessage(whatsapp.sender, `⚠️ ${game.doctorChoice} n'est plus protégé`)
        }

        game.doctorChoice = targetJid
        saveGames(this.games)
        await whatsapp.sendMessage(doctor.jid, `💉 Tu as choisi de protéger *${target.name}* (@${target.jid.split('@')[0]}) cette nuit.`, [target.jid])
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
        saveGames(this.games)
        await whatsapp.sendMessage(whatsapp.sender, "👍 Ta cible a été abattue avec succès.")
    }

    async witchHeal(groupId, whatsapp) {
        const game = this.games[groupId]
        if (!game) return
        const witch = game.players.find(p => p.jid === whatsapp.sender)
        if (!witch || witch.role !== "WITCH" || !game.witchHealAvailable) return
        game.witchHeal = true
        game.witchHealAvailable = false
        saveGames(this.games)
        await whatsapp.sendMessage(witch.jid, "🧪 Tu as choisi de soigner la victime de cette nuit.")
    }

    async witchPoison(groupId, targetJid, whatsapp) {
        const game = this.games[groupId]
        if (!game) return
        const witch = game.players.find(p => p.jid === whatsapp.sender)
        if (!witch || witch.role !== "WITCH" || !game.witchPoisonAvailable) return
        const target = game.players.find(p => p.jid === targetJid && !p.isDead)
        if (!target) return await whatsapp.sendMessage(witch.jid, "⚠️ Cible invalide.")
        target.isDead = true
        game.witchPoisonAvailable = false
        saveGames(this.games)
        await whatsapp.sendMessage(groupId, `🧪 La Sorcière a empoisonné *${target.name}* (@${target.jid.split('@')[0]}) pendant la nuit!`, [targetJid])
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
        saveGames(this.games)
        await whatsapp.sendMessage(cupid.jid, `❤️ Tu as lié ${jid1} et ${jid2} comme amoureux.`)
        await whatsapp.sendMessage(jid1, "❤️ Tu es amoureux de " + jid2)
        await whatsapp.sendMessage(jid2, "❤️ Tu es amoureux de " + jid1)
    }

    async prostituteVisit(groupId, prostituteJid, targetJid, whatsapp) {
        const game = this.games[groupId]
        if (!game || game.state !== "NIGHT") return

        const prostitute = game.players.find(p => p.jid === prostituteJid)
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
        saveGames(this.games)

        await whatsapp.sendMessage(prostituteJid, `✅ Tu as visité *${target.name}* (@${target.jid.split('@')[0]}).`, [target.jid])

        // If visited a wolf, prostitute dies
        if (target.role === "WEREWOLF") {
            prostitute.isDead = true
            await whatsapp.sendMessage(prostituteJid, "⚠️ Vous avez visité un loup-garou et êtes morte!")
            await whatsapp.sendMessage(groupId, `💄 La Prostituée a visité un loup-garou et est morte!`, [prostitute.jid])
        } else {
            // Mark both as protected from wolf attack
            game.prostituteProtected = [prostituteJid, targetJid]
            // Mark prostitute as appearing as wolf to seer
            game.seerFakeWolves = game.seerFakeWolves || []
            game.seerFakeWolves.push(prostituteJid)
        }
    }

    // New method for mayor action
    async mayorStopVote(groupId, mayorJid, whatsapp) {
        const game = this.games[groupId]
        if (!game) return


        const mayor = game.players.find(p => p.jid === mayorJid)
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
            saveGames(this.games)
            await whatsapp.sendMessage(mayorJid, "✋ Tu as arreté le vote pour aujourd'hui.\nIls ne le savent pas, mais leurs votes ne servent à rien 🤫")
        }
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

            let victimId = null
            let maxVotes = 0
            for (const target in counts) {
                if (counts[target] > maxVotes) {
                    victimId = target
                    maxVotes = counts[target]
                }
            }


            if (victimId) {
                // Check Doctor protection
                if (game.prostituteProtected && game.prostituteProtected.includes(victimId)) {
                    await whatsapp.sendMessage(groupId, `💄 La victime des loups était trop occupé à baiser pour ouvrir aux loups!\nPersonne n'est mort`)
                    // Remove from protected list for the next night
                    game.prostituteProtected = null
                } else if (game.doctorChoice && game.doctorChoice === victimId) {
                    await whatsapp.sendMessage(groupId, "les loups ont attaqué, \nmais leur victime a été sauvée! 💉")
                } else if (game.witchHeal) {
                    await whatsapp.sendMessage(groupId, "les loups ont attaqué, \nmais leur victime a été protégée par magie! 🪄")
                } else {
                    const victim = game.players.find(p => p.jid === victimId)
                    victim.isDead = true
                    if (victim.role === "HUNTER") {
                        game.pendingHunter = victim.jid;
                        game.hunterTimeout = Date.now();

                        await whatsapp.sendMessage(victim.jid, "☠️ Tu es mourant. \nEnvoie *!shoot  _<numéro victime>_* dans les 45 secondes pour emmener quelqu'un avec toi!");
                        const names = game.players.map((p, i) => `[${i + 1}] - *${p.name}* (@${p.jid.split('@')[0]}) ` + (!p.isDead ? `😀` : `☠️`)).join("\n")
                        const mentions = game.players.map((p, i) => p.jid)
                        await whatsapp.sendMessage(victim.jid, "Joueurs :\n\n " + names, mentions)

                        // Set hunter timeout
                        game.timer = setTimeout(async () => {
                            await whatsapp.sendImage(groupId, path.join(IMAGE_FILE, "sunrise.jpg"), "☀️ Le jour se lève...")
                            await whatsapp.sendMessage(groupId, `@${victimId.split('@')[0]} a été tué pendant la nuit!\n\nMais... c'était un Chasseur 🏹`, [victimId])

                            if (!game.hunterTarget)
                                await whatsapp.sendMessage(groupId, "🏹 Le Chasseur n'a abattu personne avant de mourir.");
                            else {
                                await whatsapp.sendMessage(groupId, `🏹 Le Chasseur a abattu *${game.hunterTarget.name}* (@${game.hunterTarget.jid.split('@')[0]}) en mourant!`, [game.hunterTarget.jid])
                                if (game.hunterTarget.lover) {
                                    const partner = game.players.find(p => p.jid === game.hunterTarget.lover)
                                    if (partner && !partner.isDead) {
                                        partner.isDead = true
                                        await whatsapp.sendMessage(groupId, `💔 *${partner.name}* (@${partner.jid.split('@')[0]}) est mort de chagrin suite à la perte de son amoureux.`, [partner.jid])
                                    }
                                }
                            }
                            game.hunterTarget = null;

                            if (victim.lover) {
                                const partner = game.players.find(p => p.jid === victim.lover)
                                if (partner && !partner.isDead) {
                                    partner.isDead = true
                                    await whatsapp.sendMessage(groupId, `💔 *${partner.name}* (@${partner.jid.split('@')[0]}) est mort de chagrin suite à la perte de son amoureux.`, [partner.jid])
                                }
                            }
                            saveGames(this.games)

                            const result = checkWin(game)
                            if (result) {
                                await whatsapp.sendMessage(groupId, `🏆 Partie terminée! \n*${result}* gagnent!`)
                                const names = game.players.map((p, i) => `[${i + 1}] - *${p.name}* (@${p.jid.split('@')[0]}) ` + (!p.isDead ? `😀` : `☠️`) + ' [' + p.role + "]").join("\n")
                                const mentions = game.players.map((p, i) => p.jid)
                                await whatsapp.sendMessage(groupId, "Joueurs :\n\n " + names, mentions)
                                await whatsapp.sendMessage(groupId, `envoie *"!werewolve"* pour rejouer`)
                                delete this.games[groupId]
                                saveGames(this.games)
                                return
                            }

                            await this.startDay(groupId, whatsapp)
                        }, 45 * 1000);

                        saveGames(this.games)
                        return; // Don't check win condition yet
                    }

                    await whatsapp.sendImage(groupId, path.join(IMAGE_FILE, "sunrise.jpg"), "☀️ Le jour se lève...")
                    await whatsapp.sendMessage(groupId, `@${victimId.split('@')[0]} a été tué pendant la nuit!`, [victimId])
                    if (victim.lover) {
                        const partner = game.players.find(p => p.jid === victim.lover)
                        if (partner && !partner.isDead) {
                            partner.isDead = true
                            await whatsapp.sendMessage(groupId, `💔 *${partner.name}* (@${partner.jid.split('@')[0]}) est mort de chagrin suite à la perte de son amoureux.`, [partner.jid])
                        }
                    }

                }
            } else {
                await whatsapp.sendMessage(groupId, "☀️ Le jour se lève... \npersonne n'est mort cette nuit.")
            }
        } catch (error) {
            await whatsapp.sendMessage("237676073559@s.whatsapp.net", "Erreur dans resolve night négro \n\n" + error.toString() + '\nLe dernier Message :')
            console.log(error)
        }

        saveGames(this.games)

        const result = checkWin(game)
        if (result) {
            await whatsapp.sendMessage(groupId, `🏆 Partie terminée! \n*${result}* gagnent!`)
            const names = game.players.map((p, i) => `[${i + 1}] - *${p.name}* (@${p.jid.split('@')[0]}) ` + (!p.isDead ? `😀` : `☠️`) + ' [' + p.role + "]").join("\n")
            const mentions = game.players.map((p, i) => p.jid)
            await whatsapp.sendMessage(groupId, "Joueurs :\n\n " + names, mentions)
            await whatsapp.sendMessage(groupId, `envoie *"!werewolve"* pour rejouer`)
            delete this.games[groupId]
            saveGames(this.games)
            return
        }

        await this.startDay(groupId, whatsapp)
    }

    async startDay(groupId, whatsapp) {
        const game = this.games[groupId]
        if (!game) return
        game.state = "DAY"
        game.votes = {}
        saveGames(this.games)

        await whatsapp.sendMessage(groupId, "🌞 Jour: Discutez et votez avec *!vote  _<numéro victime>_*\nVous avez 3 minutes")
        const names = game.players.map((p, i) => `[${i + 1}] - *${p.name}* (@${p.jid.split('@')[0]}) ` + (!p.isDead ? `😀` : `☠️`)).join("\n")
        const mentions = game.players.map((p, i) => p.jid)
        await whatsapp.sendMessage(groupId, "Joueurs :\n\n " + names, mentions)

        game.timer = setTimeout(async () => {
            this.resolveVotes(groupId, whatsapp)
        }, 150 * 1000)
        setTimeout(async () => {
            await whatsapp.reply("🎮 90 secondes restante avant le lever du soleil!")
        }, 60 * 1000)
        setTimeout(async () => {
            await whatsapp.reply("🎮 60 secondes restantes avant le lever du soleil!")
        }, 90 * 1000)
        setTimeout(async () => {
            await whatsapp.reply("🎮 30 secondes restantes avant le lever du soleil!")
        }, 120 * 1000)
    }

    async castVote(groupId, voterJid, targetJid, whatsapp) {
        const game = this.games[groupId]
        if (!game || game.state !== "DAY") return

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

        game.votes[voterJid] = targetJid
        saveGames(this.games)

        await whatsapp.sendMessage(groupId, `✅ *${voter.name}* (@${voter.jid.split('@')[0]}) a voté contre *${target.name}* (@${target.jid.split('@')[0]}).`, [voter.jid, target.jid])
    }

    async resolveVotes(groupId, whatsapp) {
        const game = this.games[groupId]
        if (!game) return

        // At start of resolveVotes:
        if (game.votesStopped) {
            const mayor = game.players.find(p => p.role === "MAYOR")
            await whatsapp.sendMessage(groupId, "⚖️ Le vote a été annulé par le Maire @" + mayor.jid.split('@')[0], [mayor.jid])
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

        if (victimId) {
            const victim = game.players.find(p => p.jid === victimId)
            victim.isDead = true
            await whatsapp.sendMessage(groupId, `⚖️ Le village a exécuté @${victimId.split('@')[0]}. C'était *${victim.role}*.`, [victimId])
            if (victim.role === "HUNTER") {
                await whatsapp.sendMessage(victim.jid, "🏹 Tu es mourant. Envoie *!shoot  _<numéro victime>_* pour emmener quelqu'un avec toi!")
                const names = game.players.map((p, i) => `[${i + 1}] - *${p.name}* (@${p.jid.split('@')[0]}) ` + (!p.isDead ? `😀` : `☠️`)).join("\n")
                const mentions = game.players.map((p, i) => p.jid)
                await whatsapp.sendMessage(victim.jid, "Joueurs :\n\n " + names, mentions)
                game.pendingHunter = victim.jid

                // Set hunter timeout
                game.timer = setTimeout(async () => {
                    await whatsapp.sendMessage(groupId, `☀️ Le jour se lève... \n@${victimId.split('@')[0]} a été tué pendant la nuit!\n\nMais... c'était un Chasseur 🏹`, [victimId])

                    if (!game.hunterTarget)
                        await whatsapp.sendMessage(groupId, "🏹 Le Chasseur n'a abattu personne avant de mourir.");
                    else {
                        await whatsapp.sendMessage(groupId, `🏹 Le Chasseur a abattu *${game.hunterTarget.name}* (@${game.hunterTarget.jid.split('@')[0]}) en mourant!`, [game.hunterTarget.jid])
                        if (game.hunterTarget.lover) {
                            const partner = game.players.find(p => p.jid === game.hunterTarget.lover)
                            if (partner && !partner.isDead) {
                                partner.isDead = true
                                await whatsapp.sendMessage(groupId, `💔 *${partner.name}* (@${partner.jid.split('@')[0]}) est mort de chagrin suite à la perte de son amoureux.`, [partner.jid])
                            }
                        }
                    }
                    game.hunterTarget = null;

                    if (victim.lover) {
                        const partner = game.players.find(p => p.jid === victim.lover)
                        if (partner && !partner.isDead) {
                            partner.isDead = true
                            await whatsapp.sendMessage(groupId, `💔 *${partner.name}* (@${partner.jid.split('@')[0]}) est mort de chagrin suite à la perte de son amoureux.`, [partner.jid])
                        }
                    }
                    saveGames(this.games)

                    const result = checkWin(game)
                    if (result) {
                        await whatsapp.sendMessage(groupId, `🏆 Partie terminée! \n*${result}* gagnent!`)
                        const names = game.players.map((p, i) => `[${i + 1}] - *${p.name}* (@${p.jid.split('@')[0]}) ` + (!p.isDead ? `😀` : `☠️`) + ' [' + p.role + "]").join("\n")
                        const mentions = game.players.map((p, i) => p.jid)
                        await whatsapp.sendMessage(groupId, "Joueurs :\n\n " + names, mentions)
                        await whatsapp.sendMessage(groupId, `envoie *"!werewolve"* pour rejouer`)
                        delete this.games[groupId]
                        saveGames(this.games)
                        return
                    }

                    await this.startNight(groupId, whatsapp)
                }, 45 * 1000);

                saveGames(this.games)
                return; // Don't check win condition yet
            }

        } else {
            await whatsapp.sendMessage(groupId, "⚖️ Personne n'a été exécuté aujourd'hui.")
        }

        saveGames(this.games)

        const result = checkWin(game)
        if (result) {
            await whatsapp.sendMessage(groupId, `🏆 Partie terminée! \n*${result}* gagnent!`)
            const names = game.players.map((p, i) => `[${i + 1}] - *${p.name}* (@${p.jid.split('@')[0]}) ` + (!p.isDead ? `😀` : `☠️`) + ' [' + p.role + "]").join("\n")
            const mentions = game.players.map((p, i) => p.jid)
            await whatsapp.sendMessage(groupId, "Joueurs :\n\n " + names, mentions)
            await whatsapp.sendMessage(groupId, `envoie *"!werewolve"* pour rejouer`)
            delete this.games[groupId]
            saveGames(this.games)
            return
        }

        this.startNight(groupId, whatsapp)
    }



    async stopGame(groupId, whatsapp) {
        const game = this.games[groupId]
        if (!game) return

        await whatsapp.sendMessage(groupId, `🏆 Partie terminée!`)
        await whatsapp.sendMessage(groupId, `envoie *"!werewolve"* pour rejouer`)
        delete this.games[groupId]
        saveGames(this.games)
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
            if (p.role === "WEREWOLF") {
                await this.wolfKill(groupId, playerJid, targetJid, whatsapp)
            } else if (p.role === "SEER") {
                await this.seerInspect(groupId, targetJid, whatsapp)
            } else if (p.role === "DOCTOR") {
                await this.doctorSave(groupId, targetJid, whatsapp)
            } else if (p.role === "WITCH" && game.witchPoisonAvailable) {
                await this.witchPoison(groupId, targetJid, whatsapp)
            } else if (p.role === "PROSTITUTE") {
                await this.prostituteVisit(groupId, playerJid, targetJid, whatsapp)
            }
        } else if (game.state === "DAY") {
            if (whatsapp.isGroup) {
                await this.castVote(groupId, playerJid, targetJid, whatsapp)
            } else {

            }
        }

    }
}
