// gameManager.js
import fs from "fs"
import path from "path"
import RoleManager from "./werewolve-utils/roleManager.js"
import { getUser, saveUser } from "../userStorage.js";


const DATA_FILE = path.join(process.cwd(), "games/quiz.json")

const categories = [
    { id: '9', name: "General Knowledge" },
    { id: '11', name: "Entertainment: Film" },
    { id: '14', name: "Entertainment: Television" },
    { id: '17', name: "Science & Nature" },
    { id: '18', name: "Science: Computers" },
    { id: '20', name: "Mythology" },
    { id: '21', name: "Sports" },
    { id: '26', name: "Celebrities" },
    { id: '31', name: "Anime & Manga " },
    { id: '32', name: "Cartoon & Animations" },
]

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
    Object.entries(temp).forEach(arr => { temp[arr[0]].timer = [null, null, null] })
    fs.writeFileSync(DATA_FILE, JSON.stringify(temp, null, 2))
}

function shouffleAnswers(correct, incorrect_answers) {

    let r = [{ correct: true, answer: correct }].concat(incorrect_answers.map(i => { return { correct: false, answer: i } }))

    // Shuffle r
    for (let i = r.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [r[i], r[j]] = [r[j], r[i]];
    }
    return r
}

// --- Main Manager ---
export class QuizManager {
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
            await whatsapp.reply("⚠️ A Quiz game is already running in this group.")
            return
        }

        this.games[groupId] = {
            state: "WAITING_CATEGORY",
            creator: whatsapp.sender,
            players: [], // { jid, isPlaying, isDead, role }
            questions: [],   // daytime votes { voterJid: targetJid }
            categoryVotes: {},
            rounds: -1,
            timer: [null, null, null],
        }

        saveGames(this.games)
        await whatsapp.reply("🎮 New Quiz game created! \nSend *!cat <number of category>* to vote for a category (1 minutes).")
        await whatsapp.sendMessage(groupId, "🎮 Choose a category: \n\n" + categories.map((c, i) => `[${i + 1}] - *${c.name}*`).join('\n'))


        this.games[groupId].timer[0] = setTimeout(async () => {
            await this.startGame(groupId, whatsapp)
        }, 60 * 1000)
        this.games[groupId].timer[1] = setTimeout(async () => {
            await whatsapp.sendMessage(groupId, "🎮 30 secs Left to vote! \nSend *!cat <number of category>*.")
        }, 30 * 1000)
        this.games[groupId].timer[2] = setTimeout(async () => {
            await whatsapp.sendMessage(groupId, "🎮 15 secs Left before start of game! \nSend *!cat <number of category>*")
            await whatsapp.sendMessage(groupId, "🎮 Choose a category: \n\n" + categories.map((c, i) => `[${i + 1}] - *${c.name}*`).join('\n'))
        }, 45 * 1000)
    }


    async castVoteCategory(groupId, voterJid, categoryIndex, whatsapp) {
        const game = this.games[groupId]
        if (!game || game.state !== "WAITING_CATEGORY") return

        if (categoryIndex > categories.length - 1 || categoryIndex < 0 || !categories[parseInt(categoryIndex)]) {
            await whatsapp.reply("⚠️ What number is even this shit?\nPlease send *!cat <number of category>*")
            return
        }

        game.categoryVotes[voterJid] = categories[parseInt(categoryIndex)]
        saveGames(this.games)

        await whatsapp.reply( `✅ (@${voterJid.split('@')[0]}) voted For *${categories[parseInt(categoryIndex)].name}* `, [voterJid])
    }

    async startGame(groupId, whatsapp) {
        const game = this.games[groupId]
        if (!game || game.state !== "WAITING_CATEGORY") return

        game.state = "ASSIGNING_QUESTIONS"

        const counts = {}
        for (const voter in game.categoryVotes) {
            const target = game.categoryVotes[voter]
            counts[target.id] = (counts[target.id] || 0) + 1
        }

        let categoryId = null
        let maxVotes = 0
        for (const targetid in counts) {
            if (counts[targetid] > maxVotes) {
                categoryId = targetid
                maxVotes = counts[targetid]
            }
        }

        await whatsapp.sendMessage(groupId, '✅ ' + maxVotes + " People voted for " + categories.find(cat => cat.id == categoryId).name)

        try {
            const questions = (await (await fetch('https://opentdb.com/api.php?amount=10&category=' + categoryId)).json()).results
            game.questions = [...questions];

            game.questions.forEach((quest, i) => {
                game.questions[i].answers = shouffleAnswers([quest.correct_answer], quest.incorrect_answers)
            });

            saveGames(this.games)

            await whatsapp.sendMessage(groupId, "Quiz can start!")
            this.sendQuestions(groupId, whatsapp)
        } catch (error) {
            await whatsapp.sendMessage(groupId, "Questions couldn't be gotten, sowwy!")
            delete this.games[groupId]
            saveGames(this.games)
            return
        }
    }

    async sendQuestions(groupId, whatsapp) {
        const game = this.games[groupId]
        if (!game) return

        game.state = "ANSWERING"
        game.rounds += 1

        saveGames(this.games)

        let RoundQuestion = game.questions[game.rounds].question
        let RoundAnswers = game.questions[game.rounds].answers

        // DM prompts
        await whatsapp.sendMessage(groupId, "*Round: " + game.rounds + '*\n\n' +
            '*' + RoundQuestion + "*\n" +
            RoundAnswers.map((r, i) => `*[${i + 1}]* - ${r.answer}`).join('\n') + "\n\nAnswer by sending *!ans <number>*"
        )
        await whatsapp.sendMessage(groupId, "🎮 60 secs Left before next question!")

        // Timer ends night
        game.timer[0] = setTimeout(async () => {
            await this.resolveQuiz(groupId, whatsapp)
        }, 1 * 60 * 1000)
        game.timer[1] = setTimeout(async () => {
            await whatsapp.sendMessage(groupId,"🎮 30 secs Left before next question!")
            await whatsapp.sendMessage(groupId, "*Round: " + game.rounds + '*\n\n' +
                '*' + RoundQuestion + "*\n" +
                RoundAnswers.map((r, i) => `*[${i + 1}]* - ${r.answer}`).join('\n') + "\n\nAnswer by sending *!ans <number>*"
            )
        }, 30 * 1000)
        game.timer[2] = setTimeout(async () => {
            await whatsapp.sendMessage(groupId, "🎮 15 secs Left before next question!")
            await whatsapp.sendMessage(groupId, "*Round: " + game.rounds + '*\n\n' +
                '*' + RoundQuestion + "*\n" +
                RoundAnswers.map((r, i) => `*[${i + 1}]* - ${r.answer}`).join('\n') + "\n\nAnswer by sending *!ans <number>*"
            )
        }, 45 * 1000)
    }

    async resolveQuiz(groupId, whatsapp) {
        const game = this.games[groupId]
        if (!game) return

        const _question = game.questions[game.rounds]

        // Tally wolf votes
        const answers = []
        game.players.forEach(p => {
            const p_ans = p.answers.find(a => a.questionIndex == game.rounds)
            if (p_ans) answers.push({ ...p_ans, playerJid: p.jid })
        });

        await whatsapp.sendMessage(groupId, "The answer was:\n✅ *[" + (1 + _question.answers.findIndex(a => a.correct)) + '] - ' + _question.answers.find(a => a.correct).answer + '*\n\n' +
            answers.map(a => `${a.correct ? `✅` : `❌`} @${a.playerJid.split('@')[0]}`).join('\n'), answers.map(a => a.playerJid)
        )

        saveGames(this.games)


        if (game.rounds >= 10) {
            await this.stopGame(groupId)
            return
        }

        this.sendQuestions(groupId, whatsapp)
    }

    async answerQuestion(groupId, voterJid, answerIndex, whatsapp) {
        const game = this.games[groupId]
        if (!game || game.state !== "ANSWERING") return

        const player = game.players.find(p => p.jid === voterJid)

        if (!player) {
            await whatsapp.sendMessage(groupId, `Youpiii @${voterJid.split('@')[0]} joined the game`, [voterJid])
            game.players.push({ jid: voterJid, answers: [{ questionIndex: game.rounds, answerIndex: answerIndex }] })
        } else {
            player.answers.push({ questionIndex: game.rounds, answerIndex: answerIndex, correct: game.questions[game.rounds].answers[answerIndex].correct })
        }

        saveGames(this.games)

        await whatsapp.sendMessage(groupId, `✅ @${voterJid.split('@')[0]} voted for *${game.questions[game.rounds].answers[answerIndex].answer}*`, [voterJid])
    }

    async stopGame(groupId, whatsapp) {
        const game = this.games[groupId]
        if (!game) return

        await whatsapp.sendMessage(groupId, `*🏆 Game over!* \n\n${game.players.map(p => `@${p.jid.split('@')[0]} had *${p.answers.reduce((sum, a) => sum += a.correct ? 1 : 0, 0)} correct*`).join('\n')}`, game.players.map(p => p.jid))
        await whatsapp.sendMessage(groupId, `send *"!quiz"* to play again`)
        delete this.games[groupId]
        saveGames(this.games)
        return
    }

}
