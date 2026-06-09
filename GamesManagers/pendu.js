// gameManager.js
import fs from "fs-extra"
import path from "path"
import RoleManager from "./werewolve-utils/roleManager.js"
import { getAllUsers, getUser, saveUser, SaveUsersPoints, SaveUsersfrancs, saveGroup, getGroup } from "../userStorage.js";
import { time } from "console";


const DATA_FILE = path.join(process.cwd(), "games/pendu.json")
const WORDS_FILE = path.join(process.cwd(), "GamesManagers/mots.json")

let timers = {}

const HANGMANPICS = [`
  +---+
   |       |
           |
           |
           |
           |
=========`, `
   +---+
   |       |
  O      |
           |
           |
           |
=========`, `
  +---+
   |       |
  O      |
  |       |
           |
           |
=========`, `
  +---+
   |       |
  O      |
 /|       |
           |
           |
=========`, `
  +---+
   |       |
  O      |
 /|\\     |
           |
           |
=========`, `
 +---+
   |       |
  O      |
 /|\\     |
 /        |
           |
=========`, `
  +---+
   |       |
  O      |
 /|\\     |
 / \\     |
           |
=========`]



// --- Utilities ---
function delay(ms) {
    return new Promise(resolve => {
        setTimeout(() => {
            resolve();
        }, ms);
    });
}

// --- Main Manager ---
export class PenduManager {
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
            //await whatsapp.sendMessage(groupId, "*--- Partie en cours ---*\n\nUne partie de *!mots* était en cours avant que le bot ne redémarre. Reprise de la partie")
            whatsapp.groupJid = groupId
            switch (game.state) {
                case "CHOOSING_GAME_TYPE":
                    await whatsapp.sendMessage(groupId, "⏰ 30 secondes restantes pour choisir le type de partie!")
                    timers[groupId][0] = setTimeout(async () => {
                        if (this.games[groupId] && this.games[groupId].state === "CHOOSING_GAME_TYPE") {
                            await whatsapp.sendMessage(groupId, "⏰ Temps écoulé pour choisir le type de partie! Partie annulée.\nEnvoyez *!pendu* pour réessayer.")
                            delete this.games[groupId]
                            this.saveGame(this.games)
                        }
                    }, 30 * 1000)
                    timers[groupId][1] = setTimeout(async () => {
                        await whatsapp.sendMessage(groupId, "🎮 15 secs restantes pour rejoindre la partie! \nEnvoie *1* ou *2*")
                    }, 15 * 1000)

                    break;
                case "SET_WORD":
                    game.state = "SET_WORD"
                    await this.createGame(groupId, whatsapp)
                    break;
                case "PLAYING":
                    game.state = "SET_WORD"
                    await this.startGame(groupId, whatsapp)
                    break;
                case "ENDED":
                    game.state = "PLAYING"
                    await this.resolveGame(groupId, whatsapp)
                    break;
                default:
                    whatsapp.sendMessage(groupId, 'Partie annulé, veillez envoyer *!pendu* pour relancer une partie')
                    delete this.games[groupId]
                    this.saveGame(this.games)
                    break;
            }
        }
    }

    loadGames() {
        if (!fs.existsSync(DATA_FILE)) return {}
        return JSON.parse(fs.readFileSync(DATA_FILE))
    }

    saveGame(games) {
        let temp = { ...games }
        Object.entries(temp).forEach(arr => { temp[arr[0]].timer = null })
        fs.writeFileSync(DATA_FILE, JSON.stringify(temp, null, 2))
    }

    async addUserPoints(playerJid, whatsapp, points, reason, gamescount = 0, game = null) {
        if (this.games[whatsapp.isGroup ? whatsapp.groupJid : this.getPlayerGroupJid(playerJid)].gameType === 2) {
            const c = SaveUsersfrancs(playerJid, whatsapp, points, reason, "PENDU", gamescount, game)
            if (c && this.games[whatsapp.isGroup ? whatsapp.groupJid : this.getPlayerGroupJid(playerJid)])
                this.games[whatsapp.isGroup ? whatsapp.groupJid : this.getPlayerGroupJid(playerJid)] = c
        } else {
            const c = SaveUsersPoints(playerJid, whatsapp, points, reason, "PENDU", gamescount, game)
            if (c && this.games[whatsapp.isGroup ? whatsapp.groupJid : this.getPlayerGroupJid(playerJid)])
                this.games[whatsapp.isGroup ? whatsapp.groupJid : this.getPlayerGroupJid(playerJid)] = c
        }
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

    getPlayerGroupData(playerJid) {
        const grouparr = Object.entries(this.games).find(arr => arr[1].players.some(_p => _p.jid === playerJid))
        return grouparr ? grouparr : null
    }

    getGroupData(groupJid) {
        return this.games[groupJid]
    }

    getPlayerJidFromNumber(groupId, number) {
        const game = this.games[groupId]
        return game?.players[parseInt(number)]?.jid
    }

    async chooseGameType(groupId, whatsapp) {
        if (this.games[groupId]) {
            await whatsapp.sendMessage(groupId, "🔄️ la partie va être réinitialisée !")
        }

        const words = fs.readJSONSync(WORDS_FILE).filter(w => w.label.length > 6)
        const word = words[Math.floor(Math.random() * words.length)].label


        console.log("\n\n"+ word + "\n\n");
        if (!word) {
            await whatsapp.sendMessage(groupId, "❌ Une erreur est survenue lors de la création du mot. Veuillez réessayer.")
            return
        }
        this.games[groupId] = {
            state: "CHOOSING_GAME_TYPE",
            hostjid: whatsapp.senderJid,
            players: [],
            unNormalizedWord: word,
            word: (new String(word)).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(),
            displayWord: "□".repeat(word.length).split('').map((c, i) => word[i] === " " ? " " : word[i] === "'" ? "'" : word[i] === "," ? "," : word[i] === "!" ? "!" : word[i] === "?" ? "?" : word[i] === "." ? "." : word[i] === "-" ? "-" : /^\d$/.test(word[i]) ? word[i] : c).join(""),
            guessedLetters: [],
            wrongLetters: [],
            rounds: -1,
            mise: 0,
            misePerUser: 10
        }
        this.saveGame(this.games)
        timers[groupId] = [null, null, null, null, null, null, null]



        await whatsapp.sendMessage(groupId, "🎮 Choisis le type de partie que tu veux jouer!\n\n1. Partie normale (points) (10 parties par chaque 24hrs)\n2. Partie avec mise en jeu (francs)\n\n_ps: Une partie normale coute 5 francs_")

        timers[groupId][0] = setTimeout(async () => {
            if (this.games[groupId] && this.games[groupId].state === "CHOOSING_GAME_TYPE") {
                await whatsapp.sendMessage(groupId, "⏰ Temps écoulé pour choisir le type de partie! Partie annulée.\nEnvoyez *!pendu* pour réessayer.")
                delete this.games[groupId]
                this.saveGame(this.games)
                return
            }
        }, 1 * 60 * 1000)
        timers[groupId][1] = setTimeout(async () => {
            if (this.games[groupId] && this.games[groupId].state === "CHOOSING_GAME_TYPE") {
                await whatsapp.sendMessage(groupId, "⏰ 30 secondes restantes pour choisir le type de partie!")
            }
        }, 30 * 1000)

    }

    async chooseGameVote(groupId, playerJid, vote, whatsapp) {
        const game = this.games[groupId]
        if (!game || game.state !== "CHOOSING_GAME_TYPE") return

        if (playerJid !== game.hostjid) return await whatsapp.sendMessage(groupId, "❌ Seul celui qui a créé la partie peut choisir le type de jeu.", [playerJid])

        if (parseInt(vote) === 1 || parseInt(vote) === 2) {
            game.gameType = parseInt(vote)
        } else {
            return await whatsapp.sendMessage(groupId, "❌ Mouf! Vote invalide. Envoie 1 ou 2.", [playerJid])
        }

        try {
            clearTimeout(timers[groupId][0])
        } catch (e) { }
        try {
            clearTimeout(timers[groupId][1])
        } catch (e) { }
        await this.createGame(groupId, whatsapp)
    }

    async createGame(groupId, whatsapp) {

        this.games[groupId].state = "SET_WORD"

        this.saveGame(this.games)
        const game = this.games[groupId]

        let PlayingFee = 0

        if (this.games[groupId].gameType === 1) {
            const hostUser = this.games[groupId].hostjid ? getUser(this.games[groupId].hostjid) : null
            if (hostUser && hostUser.francs >= 5) {
                await SaveUsersfrancs(this.games[groupId].hostjid, whatsapp, -5, "a lancé une partie de loup avec points", "PENDU", 0, this.games[groupId])
                let user = getUser(whatsapp.senderJid);
                if (user) {
                    if ((user.LastHangGame && Date.now() - user.LastHangGame < 24 * 60 * 60 * 1000)) {
                        if (user.hangGameCreated > 0) {
                            user.hangGameCreated = (user.hangGameCreated) - 1;
                        } else {
                            const nextCreationTime = user.LastHangGame + 24 * 60 * 60 * 1000;
                            const nextCreationDate = new Date(nextCreationTime);
                            await whatsapp.sendMessage(groupId, "🧩 Tu as déjà créé trop de parties du pendu ! Tu dois attendre jusqu'au *" + nextCreationDate.toLocaleString() + "* avant d'en créer une autre.");
                            delete this.games[groupId]
                            this.saveGame(this.games)
                            return;
                        }
                    } else {
                        user.LastHangGame = Date.now();
                        user.hangGameCreated = 3;
                    }
                    saveUser(user);
                }
            } else if (hostUser && hostUser.francs < 5) {
                await whatsapp.sendMessage(groupId, "⚠️ Le créateur de la partie n'a pas assez de francs pour lancer une partie points. Partie annulée.\nEnvoyez *!pendu* pour réessayer.")
                delete this.games[groupId]
                this.saveGame(this.games)
                return
            } else {
                await whatsapp.sendMessage(groupId, "Une érreur est survenue lors de la vérification des francs du créateur de la partie. Partie annulée.\nEnvoyez *!pendu* pour réessayer.")
                delete this.games[groupId]
                this.saveGame(this.games)
                return
            }
        } else {

        }

        await whatsapp.sendMessage(groupId, "🪢 Nouvelle partie du Pendu" + (game.gameType == 2 ? "\n\n Une partie de pendu coutera *" + this.games[groupId].misePerUser + " francs* et vous remportez le totale des francs misé" : ""))
        await this.startGame(groupId, whatsapp)

    }


    async startGame(groupId, whatsapp) {
        const game = this.games[groupId]
        if (!game || game.state !== "SET_WORD") return

        game.state = "PLAYING"

        await whatsapp.sendMessage(groupId, `La partie commence !\n\n${HANGMANPICS[0]}\n\n${game.unNormalizedWord.toUpperCase().includes(' ') ? 'Mot' : 'Expression'} à deviner :\n ${game.displayWord.toUpperCase().split("").join("")}\n\nEnvoyez une lettre pour commencer à jouer !`)

    }

    async resolveGame(groupId, whatsapp) {
        const game = this.games[groupId]
        if (!game) return
        const playerScores = game.players.map(p => {
            const correctCount = p.answers.reduce((sum, a) => sum += a.correct ? 1 : 0, 0)
            const incorrectCount = p.answers.reduce((sum, a) => sum += !a.correct ? 1 : 0, 0)

            return { jid: p.jid, correctCount, incorrectCount }
        })

        //const percentageLeft = 100 - (game.wrongLetters.length * 17.5)
        const paidMise = game.mise * (95 / 100)
        const totalPoints = playerScores.reduce((sum, p) => sum += ((p.correctCount - p.incorrectCount) < 0 ? (0) : (p.correctCount - p.incorrectCount)), 0)

        if (game.gameType === 2) {
            await whatsapp.sendMessage(groupId, `Scores:\n\n${playerScores.sort((a, b) => (b.correctCount - b.incorrectCount) - (a.correctCount - a.incorrectCount)).map(p => {
                let playerFraction = totalPoints > 0 ? ((p.correctCount - p.incorrectCount) < 0 ? (0) : (p.correctCount - p.incorrectCount)) / totalPoints : 0
                return `@${p.jid.split('@')[0]}:\n✅ *${p.correctCount}* lettres correctes\n❌ *${p.incorrectCount}* lettres incorrectes \n *+${Math.round((playerFraction * paidMise))} francs*`
            }).join('\n\n')}`
                , playerScores.map(p => p.jid))
        } else {
            await whatsapp.sendMessage(groupId, `Scores:\n\n${playerScores.sort((a, b) => (b.correctCount - b.incorrectCount) - (a.correctCount - a.incorrectCount)).map(p =>
                `@${p.jid.split('@')[0]}:\n✅ *${p.correctCount}* lettres correctes\n❌ *${p.incorrectCount}* lettres incorrectes \n *+${(p.correctCount) - p.incorrectCount} points*`).join('\n\n')}`
                , playerScores.map(p => p.jid))
        }

        for (let p of playerScores) {
            const points = (p.correctCount) - p.incorrectCount
            let playerFraction = totalPoints > 0 ? ((points < 0 ? 0 : points) / totalPoints) : 0
            console.log("POINTS ====== ", points, " TOTAL POINTS ====== ", totalPoints, " PAID MISE ====== ", paidMise)
            await this.addUserPoints(p.jid, whatsapp, game.gameType === 2 ? (totalPoints <= 0 ? 0 : Math.round((playerFraction * paidMise))) : points, "pendu points", 1, game)
        }

        // Save game result to group data
        const groupData = getGroup(groupId)
        if (!groupData) {
            saveGroup({
                jid: groupId,
                games: [
                    {
                        gameType: "PENDU",
                        game: game,
                        time: Date.now()
                    }
                ]
            })
        } else {
            groupData.games.push({
                gameType: "PENDU",
                game: game,
                time: Date.now()
            })
            saveGroup(groupData)
        }

        await whatsapp.sendMessage(groupId, `envoie *"!pendu"* Pour jouer à nouveau`)
        delete this.games[groupId]
        this.saveGame(this.games)
        return

    }

    async giveLetter(groupId, voterJid, letter, whatsapp) {
        const game = this.games[groupId]
        if (!game || game.state !== "PLAYING") return
        if (letter.length !== 1 || !letter.match(/[a-z]/i)) {
            return
        }

        if (game.guessedLetters.includes(letter)) {
            await whatsapp.sendMessage(groupId, `Mouf, La lettre *${letter}* a déjà été proposée !`, [voterJid])
            return
        }

        const player = game.players.find(p => p.jid === voterJid)

        if (!player) {
            const user = getUser(voterJid)
            if (game.gameType === 2 && user.francs < game.misePerUser) {
                await whatsapp.sendMessage(groupId, "⚠️ Tu n'as pas assez de francs pour rejoindre une partie avec mise en jeu.");
                return;
            }
            await whatsapp.sendMessage(groupId, `Youpiii @${voterJid.split('@')[0]} a rejoin la partie`, [voterJid])
            game.players.push({ jid: voterJid, answers: [{ letter, correct: game.word.includes(letter) }], points: [] })
            game.mise += game.gameType === 2 ? game.misePerUser : 0
            await this.addUserPoints(voterJid, whatsapp, game.gameType === 2 ? -game.misePerUser : 0, "rejoint partie pendu", 0, game)

            if (user) {
                user.lid = whatsapp.ids.lid || user.lid || null
                saveUser(user)
            }
        } else {
            player.answers.push({ letter, correct: game.word.includes(letter) })
        }

        game.guessedLetters.push(letter)

        if (game.word.includes(letter)) {
            // Correct letter
            let newDisplay = ""
            for (let i = 0; i < game.word.length; i++) {
                if (game.word[i] === letter) {
                    newDisplay += letter
                } else {
                    newDisplay += game.displayWord[i]

                }
            }

            game.displayWord = newDisplay

            await whatsapp.sendMessage(groupId, `🎉 Bravo ! La lettre *${letter}* est dans le ${game.unNormalizedWord.toUpperCase().includes(' ') ? 'mot' : 'expression'}.\n\n${HANGMANPICS[game.wrongLetters.length]}\n\n${game.unNormalizedWord.toUpperCase().includes(' ') ? 'Mot' : 'Expression'} à deviner :\n ${game.displayWord.toUpperCase().split("").join("")}` + (game.gameType === 2 ? "\n\n💸 Partie avec mise de *" + game.mise + " francs*" : "\n\n🪙 Partie normale, pas de mise en jeu"))
        } else {
            // Wrong letter
            game.wrongLetters.push(letter)
            await whatsapp.sendMessage(groupId, `❌ Oops ! La lettre *${letter}* n'est pas dans le ${game.unNormalizedWord.toUpperCase().includes(' ') ? 'mot' : 'expression'}.\n\n${HANGMANPICS[game.wrongLetters.length]}\n\n${game.unNormalizedWord.toUpperCase().includes(' ') ? 'Mot' : 'Expression'} à deviner :\n ${game.displayWord.toUpperCase().split("").join("")}` + (game.gameType === 2 ? "\n\n💸 Partie avec mise de *" + game.mise + " francs*" : "\n\n🪙 Partie normale, pas de mise en jeu"))
        }
        if (game.displayWord === game.word) {
            await whatsapp.sendMessage(groupId, `🏆 Félicitations ! ${game.unNormalizedWord.toUpperCase().includes(' ') ? 'Le mot' : 'L\'expression'} *${game.unNormalizedWord}* a été deviné correctement !` + (game.gameType === 2 ? "\n\n💸 Partie avec mise de *" + game.mise + " francs*" : "\n\n🪙 Partie normale, pas de mise en jeu"))
            await this.resolveGame(groupId, whatsapp)
            return
        }
        if (game.wrongLetters.length >= HANGMANPICS.length - 1) {
            await whatsapp.sendMessage(groupId, `💀 La partie est terminée ! ${game.unNormalizedWord.toUpperCase().includes(' ') ? 'Le mot' : 'L\'expression'} était *${game.unNormalizedWord}*.\n\n${HANGMANPICS[HANGMANPICS.length - 1]}` + (game.gameType === 2 ? "\n\n💸 Partie avec mise de *" + game.mise + " francs*" : "\n\n🪙 Partie normale, pas de mise en jeu"))
            await this.resolveGame(groupId, whatsapp)
            return
        }

        this.saveGame(this.games)

    }

    async stopGame(groupId, whatsapp) {
        const game = this.games[groupId]
        if (!game) return

        await whatsapp.sendMessage(groupId, `*🏆 Partie annulé!*`)
        await whatsapp.sendMessage(groupId, `envoie *"!pendu"* pour jouer à nouveau`)
        delete this.games[groupId]
        this.saveGame(this.games)
        return
    }

    async handleShortHand(groupId, playerJid, choice, whatsapp) {
        const game = this.games[groupId]
        if (!game) return

        if (game.state === "PLAYING") {
            await this.giveLetter(groupId, playerJid, choice.toLowerCase(), whatsapp)
        } else if (game.state === "CHOOSING_GAME_TYPE") {
            console.log("CHOICE ===== ", choice)
            await this.chooseGameVote(groupId, playerJid, parseInt(choice), whatsapp)
        }

    }

}
