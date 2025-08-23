// gameManager.js
import fs from "fs"
import path from "path"
import RoleManager from "./werewolve-utils/roleManager.js"
import { getUser, saveUser } from "../userStorage.js";


const DATA_FILE = path.join(process.cwd(), "games/werewolves.json")

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
        }

        saveGames(this.games)
        await whatsapp.reply("🎮 Nouvelle partie de loup garou, *Awoooo!😭* \nEnvoie *!play _pseudo_* pour rejoindre (3 minutes restantes).")

        this.games[groupId].timer = setTimeout(async () => {
            await this.startGame(groupId, whatsapp)
        }, 3 * 60 * 1000)
        setTimeout(async () => {
            await whatsapp.sendMessage(groupId, "🎮 1 Minutes restantes pour rejoindre la partie! \nEnvoie *!play _pseudo_*")
        }, 2 * 60 * 1000)
        setTimeout(async () => {
            await whatsapp.sendMessage(groupId, "🎮 30 secondes restantes pour rejoindre la partie! \nEnvoie *!play _pseudo_*.")
        }, 30000 + (2 * 60 * 1000))
        setTimeout(async () => {
            await whatsapp.sendMessage(groupId, "🎮 15 secs restantes pour rejoindre la partie! \nEnvoie *!play _pseudo_*.")
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

        const names = game.players.map((p, i) => `[${i}] - *${p.name}* (@${p.jid.split('@')[0]}) ` + (!p.isDead ? `😀` : `☠️`)).join("\n")
        const mentions = game.players.map((p, i) => p.jid)

        await whatsapp.reply(`✅ Tu as rejoins!\n\nListe des joueurs:\n\n${names}`, mentions)

        const user = getUser(playerJid)
        if (!user) {
            saveUser({ id: playerJid, groups: [groupId], dateCreated: Date.now(), pushName: whatsapp.raw?.pushName })
        } else {
            if (!user.groups.some(g => g === groupId)) {
                user.groups.push(groupId)
                saveUser(user)
            }
        }
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
            await whatsapp.sendMessage(groupId, "⚠️ Une érreur lors de l'assignation des rôles, my bad ✋😐🤚. Jeu annulé.");
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
        }

        await whatsapp.sendMessage(groupId, "🌙 La nuit est tombé... \nSeul les prostitués rodent.... Du moin... c'est ce qu'elles pensent, \n\nVous avez 3 minutes")
        this.startNight(groupId, whatsapp)
    }

    async startNight(groupId, whatsapp) {
        const game = this.games[groupId]
        if (!game) return

        game.state = "NIGHT"
        game.wolfChoices = {}
        game.nights += 1
        game.seerChoice = null
        game.doctorChoice = null

        saveGames(this.games)

        // DM prompts
        for (const p of game.players) {
            if (!p.isDead) {
                console.log("sending role to", p.name)
                await delay(1500)
                if (p.role === "WEREWOLF") {
                    await whatsapp.sendMessage(p.jid, "🐺 Nuit: \nEnvoie *!kill _<victim number>_* Pour voter qui vous allez dévorer.")
                } else if (p.role === "SEER") {
                    await whatsapp.sendMessage(p.jid, "🔮 Nuit: \nEnvoie *!see _<victim number>_* pour voir si il est un loup.")
                } else if (p.role === "DOCTOR") {
                    await whatsapp.sendMessage(p.jid, "💉 Nuit: \nEnvoie *!save _<victim number>_* pour protéger quelqu'un.")
                } else if (p.role === "WITCH" && (game.witchHealAvailable && game.witchPoisonAvailable)) {
                    await whatsapp.sendMessage(p.jid, "🧪 Nuit: \nEnvoie \n- *!heal* (et sauve la victime des loups pour ce soir) ou \n- *!poison _<victim number>_* (pour tuer quelqu'un).\n Tu ne peux le faire qu'une fois durant tout le jeu.")
                } else if (p.role === "CUPID" && game.nights == 1) {
                    await whatsapp.sendMessage(p.jid, "❤️ Nuit: \nChoose two lovers: *!love _<1st victim number>_ _<2nd Victime number>_* (This is the only chance you get to link, after this occation you are a simple villager)")
                } else {
                    await whatsapp.sendMessage(p.jid, "😴 Nuit: \n sleep peacefully.")
                }
                if (p.role !== "VILLAGER" && p.role !== "HUNTER") {
                    if ((p.role === "WITCH" && (!game.witchHealAvailable && !game.witchPoisonAvailable))) return
                    if ((p.role === "CUPID" && game.nights !== 1)) return
                    await delay(1000)
                    const names = game.players.map((p, i) => `[${i}] - *${p.name}* (@${p.jid.split('@')[0]}) ` + (!p.isDead ? `😀` : `☠️`)).join("\n")
                    const mentions = game.players.map((p, i) => p.jid)
                    await whatsapp.sendMessage(p.jid, "Players :\n\n" + names, mentions)
                }
            }
        }

        // Timer ends night
        game.timer = setTimeout(async () => {
            await this.resolveNight(groupId, whatsapp)
        }, 3 * 60 * 1000)
        setTimeout(async () => {
            await whatsapp.reply("🎮 1 Minutes Left before sunrise!")
        }, 2 * 60 * 1000)
        setTimeout(async () => {
            await whatsapp.reply("🎮 30 secs Left before sunrise!")
        }, 30000 + (2 * 60 * 1000))
        setTimeout(async () => {
            await whatsapp.reply("🎮 15 secs Left before sunrise!")
        }, 45000 + (2 * 60 * 1000))
    }

    async wolfKill(groupId, wolfJid, targetJid, whatsapp) {
        const game = this.games[groupId]
        if (!game || game.state !== "NIGHT") return

        const wolf = game.players.find(p => p.jid === wolfJid)
        if (!wolf || wolf.role !== "WEREWOLF" || wolf.isDead) {
            await whatsapp.sendMessage(wolfJid, "⚠️ You are not allowed to kill.")
            return
        }

        const target = game.players.find(p => p.jid === targetJid && !p.isDead)
        if (!target) {
            await whatsapp.sendMessage(wolfJid, "⚠️ Invalid target.")
            return
        }

        game.wolfChoices[wolfJid] = targetJid
        saveGames(this.games)

        await whatsapp.sendMessage(groupId, `🐺 The werewolves are shouting at the moon.`)
        await whatsapp.sendMessage(wolfJid, `✅ You selected *${target.name}* (@${target.jid.split('@')[0]})  as your victim.`, [target.jid])
    }

    async seerInspect(groupId, targetJid, whatsapp) {
        const game = this.games[groupId]
        if (!game || game.state !== "NIGHT") return

        const seer = game.players.find(p => p.jid === whatsapp.sender)
        if (!seer || seer.role !== "SEER" || seer.isDead) {
            await whatsapp.sendMessage(whatsapp.sender, "⚠️ You cannot use Seer ability.")
            return
        }

        const target = game.players.find(p => p.jid === targetJid && !p.isDead)
        if (!target) {
            await whatsapp.sendMessage(whatsapp.sender, "⚠️ Invalid target.")
            return
        }

        if (game.seerChoice) {
            await whatsapp.sendMessage(whatsapp.sender, `⚠️ You can only use your ability once per Nights`)
            return
        }

        game.seerChoice = targetJid
        saveGames(this.games)

        const result = target.role === "WEREWOLF" ? "a 🐺 Werewolf" : "not a Werewolf"
        await whatsapp.sendMessage(seer.jid, `🔮 Result: \n*${target.name}* (@${target.jid.split('@')[0]})  is ${result}.`, [target.jid])
    }

    async doctorSave(groupId, targetJid, whatsapp) {
        const game = this.games[groupId]
        if (!game || game.state !== "NIGHT") return


        const doctor = game.players.find(p => p.jid === whatsapp.sender)
        if (!doctor || doctor.role !== "DOCTOR" || doctor.isDead) {
            await whatsapp.sendMessage(whatsapp.sender, "⚠️ You cannot use Doctor ability.")
            return
        }

        const target = game.players.find(p => p.jid === targetJid && !p.isDead)
        if (!target) {
            await whatsapp.sendMessage(whatsapp.sender, "⚠️ Invalid target.")
            return
        }

        if (game.doctorChoice) {
            await whatsapp.sendMessage(whatsapp.sender, `⚠️ ${game.doctorChoice} is no more protected`)
        }

        game.doctorChoice = targetJid
        saveGames(this.games)
        await whatsapp.sendMessage(doctor.jid, `💉 You chose to protect *${target.name}* (@${target.jid.split('@')[0]}) tonight.`, [target.jid])
    }

    async hunterShoot(groupId, targetJid, whatsapp) {
        const game = this.games[groupId]
        if (!game || game.pendingHunter !== whatsapp.sender) return
        const target = game.players.find(p => p.jid === targetJid && !p.isDead)
        if (!target) {
            await whatsapp.sendMessage(whatsapp.sender, "⚠️ Invalid target.")
            return
        }
        target.isDead = true
        game.pendingHunter = null
        game.hunterTarget = target
        saveGames(this.games)
        await whatsapp.sendMessage(whatsapp.sender, "👍 Your target was successfully shot.")
    }

    async witchHeal(groupId, whatsapp) {
        const game = this.games[groupId]
        if (!game) return
        const witch = game.players.find(p => p.jid === whatsapp.sender)
        if (!witch || witch.role !== "WITCH" || !game.witchHealAvailable) return
        game.witchHeal = true
        game.witchHealAvailable = false
        saveGames(this.games)
        await whatsapp.sendMessage(witch.jid, "🧪 You chose to heal tonight’s victim.")
    }

    async witchPoison(groupId, targetJid, whatsapp) {
        const game = this.games[groupId]
        if (!game) return
        const witch = game.players.find(p => p.jid === whatsapp.sender)
        if (!witch || witch.role !== "WITCH" || !game.witchPoisonAvailable) return
        const target = game.players.find(p => p.jid === targetJid && !p.isDead)
        if (!target) return await whatsapp.sendMessage(witch.jid, "⚠️ Invalid target.")
        target.isDead = true
        game.witchPoisonAvailable = false
        saveGames(this.games)
        await whatsapp.sendMessage(groupId, `🧪 The Witch poisoned *${target.name}* (@${target.jid.split('@')[0]}) during the night!`, [targetJid])
    }

    async cupidPair(groupId, jid1, jid2, whatsapp) {
        const game = this.games[groupId]
        const cupid = game.players.find(p => p.jid === whatsapp.sender)
        if (!cupid || cupid.role !== "CUPID") return
        const p1 = game.players.find(p => p.jid === jid1)
        const p2 = game.players.find(p => p.jid === jid2)
        if (game.nights !== 1) return await whatsapp.sendMessage(cupid.jid, "⚠️ You can only link 2 lovers on the first night.\nAfter the first night your are just a villager")
        if (!p1 || !p2) return await whatsapp.sendMessage(cupid.jid, "⚠️ Invalid lovers.")
        p1.lover = jid2
        p2.lover = jid1
        saveGames(this.games)
        await whatsapp.sendMessage(cupid.jid, `❤️ You linked ${jid1} and ${jid2} as lovers.`)
        await whatsapp.sendMessage(jid1, "❤️ You are in love with " + jid2)
        await whatsapp.sendMessage(jid2, "❤️ You are in love with " + jid1)
    }


    async resolveNight(groupId, whatsapp) {
        const game = this.games[groupId]
        if (!game) return

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
            if (game.doctorChoice && game.doctorChoice === victimId) {
                await whatsapp.sendMessage(groupId, "☀️ Day breaks... the wolves attacked, \nbut their victim was saved! 💉")
            } else if (game.witchHeal) {
                await whatsapp.sendMessage(groupId, "☀️ Day breaks... the wolves attacked, \nbut their victim was Protected by magic! 🪄")
            } else {
                const victim = game.players.find(p => p.jid === victimId)
                victim.isDead = true
                if (victim.role === "HUNTER") {
                    game.pendingHunter = victim.jid;
                    game.hunterTimeout = Date.now();

                    await whatsapp.sendMessage(victim.jid, "☠️ You are dying. \nEnvoie *!shoot  _<victim number>_* within 45 seconds to take someone down with you!");
                    const names = game.players.map((p, i) => `[${i}] - *${p.name}* (@${p.jid.split('@')[0]}) ` + (!p.isDead ? `😀` : `☠️`)).join("\n")
                    const mentions = game.players.map((p, i) => p.jid)
                    await whatsapp.sendMessage(victim.jid, "Players :\n\n " + names, mentions)

                    // Set hunter timeout
                    game.timer = setTimeout(async () => {
                        await whatsapp.sendMessage(groupId, `☀️ Day breaks... \n@${victimId.split('@')[0]} was killed during the night!\n\nBut... he was a Hunter 🏹`, [victimId])

                        if (!game.hunterTarget)
                            await whatsapp.sendMessage(groupId, "🏹 Hunter didn't shoot anyone before dying.");
                        else
                            await whatsapp.sendMessage(groupId, `🏹 Hunter shot *${game.hunterTarget.name}* (@${game.hunterTarget.jid.split('@')[0]}) as they died!`, [game.hunterTarget.jid])

                        game.hunterTarget = null;

                        if (victim.lover) {
                            const partner = game.players.find(p => p.jid === victim.lover)
                            if (partner && !partner.isDead) {
                                partner.isDead = true
                                await whatsapp.sendMessage(groupId, `💔 *${partner.name}* (@${partner.jid.split('@')[0]}) died of heartbreak as their lover perished.`, [partner.jid])
                            }
                        }
                        saveGames(this.games)

                        const result = checkWin(game)
                        if (result) {
                            await whatsapp.sendMessage(groupId, `🏆 Game over! \n*${result}* win!`)
                            await whatsapp.sendMessage(groupId, `send *"!werewolve"* to play again`)
                            delete this.games[groupId]
                            saveGames(this.games)
                            return
                        }

                        this.startDay(groupId, whatsapp)
                    }, 45 * 1000);

                    saveGames(this.games)
                    return; // Don't check win condition yet
                }

                await whatsapp.sendMessage(groupId, `☀️ Day breaks... \n@${victimId.split('@')[0]} was killed during the night!`, [victimId])
                if (victim.lover) {
                    const partner = game.players.find(p => p.jid === victim.lover)
                    if (partner && !partner.isDead) {
                        partner.isDead = true
                        await whatsapp.sendMessage(groupId, `💔 *${partner.name}* (@${partner.jid.split('@')[0]}) died of heartbreak as their lover perished.`, [partner.jid])
                    }
                }

            }
        } else {
            await whatsapp.sendMessage(groupId, "☀️ Day breaks... \nnobody died tonight.")
        }

        saveGames(this.games)

        const result = checkWin(game)
        if (result) {
            await whatsapp.sendMessage(groupId, `🏆 Game over! \n*${result}* win!`)
            await whatsapp.sendMessage(groupId, `send *"!werewolve"* to play again`)
            delete this.games[groupId]
            saveGames(this.games)
            return
        }

        this.startDay(groupId, whatsapp)
    }

    async startDay(groupId, whatsapp) {
        const game = this.games[groupId]
        if (!game) return
        game.state = "DAY"
        game.votes = {}
        saveGames(this.games)

        await whatsapp.sendMessage(groupId, "🌞 Daytime: Discuss and vote with *!vote  _<victim number>_*\nYou have 3 minutes")
        const names = game.players.map((p, i) => `[${i}] - *${p.name}* (@${p.jid.split('@')[0]}) ` + (!p.isDead ? `😀` : `☠️`)).join("\n")
        const mentions = game.players.map((p, i) => p.jid)
        await whatsapp.sendMessage(groupId, "Players :\n\n " + names, mentions)

        game.timer = setTimeout(async () => {
            this.resolveVotes(groupId, whatsapp)
        }, 3 * 60 * 1000)
        setTimeout(async () => {
            await whatsapp.reply("🎮 1 Minutes Left before sunrise!")
        }, 2 * 60 * 1000)
        setTimeout(async () => {
            await whatsapp.reply("🎮 30 secs Left before sunrise!")
        }, 30000 + (2 * 60 * 1000))
        setTimeout(async () => {
            await whatsapp.reply("🎮 15 secs Left before sunrise!")
        }, 45000 + (2 * 60 * 1000))
    }

    async castVote(groupId, voterJid, targetJid, whatsapp) {
        const game = this.games[groupId]
        if (!game || game.state !== "DAY") return

        const voter = game.players.find(p => p.jid === voterJid)
        const target = game.players.find(p => p.jid === targetJid && !p.isDead)

        if (!voter || voter.isDead) {
            await whatsapp.reply("⚠️ You cannot vote.")
            return
        }
        if (!target) {
            await whatsapp.reply("⚠️ Invalid vote target.")
            return
        }

        game.votes[voterJid] = targetJid
        saveGames(this.games)

        await whatsapp.sendMessage(groupId, `✅ *${voter.name}* (@${voter.jid.split('@')[0]}) voted against *${target.name}* (@${target.jid.split('@')[0]}).`, [voter.jid, target.jid])
    }

    async resolveVotes(groupId, whatsapp) {
        const game = this.games[groupId]
        if (!game) return

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
            await whatsapp.sendMessage(groupId, `⚖️ The village executed @${victimId.split('@')[0]}. They were *${victim.role}*.`, [victimId])
            if (victim.role === "HUNTER") {
                await whatsapp.sendMessage(victim.jid, "🏹 You are dying. Envoie *!shoot  _<victim number>_* to take someone down with you!")
                const names = game.players.map((p, i) => `[${i}] - *${p.name}* (@${p.jid.split('@')[0]}) ` + (!p.isDead ? `😀` : `☠️`)).join("\n")
                const mentions = game.players.map((p, i) => p.jid)
                await whatsapp.sendMessage(victim.jid, "Players :\n\n " + names, mentions)
                game.pendingHunter = victim.jid
            }

        } else {
            await whatsapp.sendMessage(groupId, "⚖️ No one was executed today.")
        }

        saveGames(this.games)

        const result = checkWin(game)
        if (result) {
            await whatsapp.sendMessage(groupId, `🏆 Game over! \n*${result}* win!`)
            await whatsapp.sendMessage(groupId, `send *"!werewolve"* to play again`)
            delete this.games[groupId]
            saveGames(this.games)
            return
        }

        this.startNight(groupId, whatsapp)
    }



    async stopGame(groupId, whatsapp) {
        const game = this.games[groupId]
        if (!game) return

        await whatsapp.sendMessage(groupId, `*Game Stopped!*`)
        await whatsapp.sendMessage(groupId, `send *"!werewolve"* to play again`)
        delete this.games[groupId]
        saveGames(this.games)
        return
    }

}
