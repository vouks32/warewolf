import fs from "fs";
import path from "path";
import { getUser, saveUser, getAllUsers, SaveUsersfrancs, SaveUsersPoints, getGroup, saveGroup } from "../userStorage.js";
import { parseWiktionary } from "./guessword-utils/checkword.js";

const DATA_FILE = path.join(process.cwd(), "games/wordgame.json");

const VOWELS = ["A", "E", "I", "O", "U", "Y", "A", "E", "I", "O", "U", "Y", "È", "É", "Ê",];
const CONSONANTS = "BCÇDFGHJKLMNPQRSTVWXZBCDFGHJKLMNPQRSTVWXZÇ".split("");
let timers = {}

export class WordGameManager {
    constructor() {
        this.games = this.loadGames();
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
                            await whatsapp.sendMessage(groupId, "⏰ Temps écoulé pour choisir le type de partie! Partie annulée.\nEnvoyez *!mots* pour réessayer.")
                            delete this.games[groupId]
                            this.saveGame(this.games)
                        }
                    }, 30 * 1000)
                    timers[groupId][1] = setTimeout(async () => {
                        await whatsapp.sendMessage(groupId, "🎮 15 secs restantes pour rejoindre la partie! \nEnvoie *1* ou *2*")
                    }, 15 * 1000)

                    break;
                case "WAITING_PLAYERS":
                    await whatsapp.sendMessage(groupId, "🎮 60 secs restantes pour rejoindre la partie! \nEnvoie *!play _pseudo_*")
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
                case "PLAYING":
                    game.state = "PLAYING"
                    await this.startRound(groupId, whatsapp)
                    break;
                case "ENDED":
                    game.state = "PLAYING"
                    await this.endGame(groupId, whatsapp)
                    break;
                default:
                    whatsapp.sendMessage(groupId, 'Partie annulé, veillez envoyer *!mots* pour relancer une partie')
                    delete this.games[groupId]
                    this.saveGame(this.games)
                    break;
            }
        }
    }

    // ---------------- UTILS ----------------

    loadGames() {
        if (!fs.existsSync(DATA_FILE)) return {}
        return JSON.parse(fs.readFileSync(DATA_FILE))
    }

    saveGame(games) {
        let temp = { ...games }
        Object.entries(temp).forEach(arr => { temp[arr[0]].timer = null })
        fs.writeFileSync(DATA_FILE, JSON.stringify(temp, null, 2))
    }

    generateLetters() {
        const vowelCount = Math.floor(Math.random() * 3) + 6; // entre 6 et 8 voyelles
        const consonantCount = 18 - vowelCount;

        const v = [...VOWELS]
        const c = [...CONSONANTS]

        const vowels = Array.from({ length: vowelCount }, () => {
            let n = Math.floor(Math.random() * v.length)
            return v.splice(n, 1)[0]
        }
        );
        const consonants = Array.from({ length: consonantCount }, () => {
            let n = Math.floor(Math.random() * c.length)
            return c.splice(n, 1)[0]
        }
        );
        const letters = [...vowels, ...consonants].sort(() => Math.random() - 0.5);
        return letters;
    }

    async addUserPoints(playerJid, whatsapp, points, reason, gamescount = 0, game = null) {
        if (game?.gameType === 2) {
            const c = SaveUsersfrancs(playerJid, whatsapp, points, reason, "WORDGAME", gamescount, game)
            if (c && this.games[whatsapp.isGroup ? whatsapp.groupJid : this.getPlayerGroupJid(playerJid)])
                this.games[whatsapp.isGroup ? whatsapp.groupJid : this.getPlayerGroupJid(playerJid)] = c
        } else {
            const c = SaveUsersPoints(playerJid, whatsapp, points, reason, "WORDGAME", gamescount, game)
            if (c && this.games[whatsapp.isGroup ? whatsapp.groupJid : this.getPlayerGroupJid(playerJid)])
                this.games[whatsapp.isGroup ? whatsapp.groupJid : this.getPlayerGroupJid(playerJid)] = c
        }
    }


    getPlayerGroupJid(playerJid) {
        const grouparr = Object.entries(this.games).find(arr => arr[1].players.some(_p => _p.jid === playerJid))
        return grouparr ? grouparr[0] : null
    }
    // ---------------- LOGIC ----------------


    async chooseGameType(groupId, whatsapp) {
        if (this.games[groupId]) {
            await whatsapp.sendMessage(groupId, "🧩 Une partie est déjà en cours !");
            return;
        }

        timers[groupId] = [null, null, null, null, null, null, null]

        const letters = this.generateLetters();
        this.games[groupId] = {
            groupId,
            hostjid: whatsapp.senderJid,
            letters,
            state: "CHOOSING_GAME_TYPE",
            players: [], // {jid: {words:[], score:0, currentWord: null, currentScore: 0}}
            timer: null,
            currentRound: 0,
            totalRounds: 5,
            roundTimer: null,
            mise: 0,
            misePerUser: 10,
        };
        this.saveGame();

        await whatsapp.sendMessage(groupId, "🎮 Choisis le type de partie que tu veux jouer!\n\n1. Partie normale (points) (10 parties par chaque 24hrs)\n2. Partie avec mise en jeu (francs)\n\n_ps: Une partie normale coute 5 francs_")

        timers[groupId][0] = setTimeout(async () => {
            if (this.games[groupId] && this.games[groupId].state === "CHOOSING_GAME_TYPE") {
                await whatsapp.sendMessage(groupId, "⏰ Temps écoulé pour choisir le type de partie! Partie annulée.\nEnvoyez *!mots* pour réessayer.")
                delete this.games[groupId]
                this.saveGame(this.games)
            }
        }, 1 * 60 * 1000)
        timers[groupId][1] = setTimeout(async () => {
            if (this.games[groupId] && this.games[groupId].state === "CHOOSING_GAME_TYPE") {
                await whatsapp.sendMessage(groupId, "⏰ 30 secondes restantes pour choisir le type de partie!")
            }
        }, 30 * 1000)

    }

    async createGame(groupId, whatsapp) {

        const game = this.games[groupId]
        game.state = "WAITING_PLAYERS"
        this.saveGame();

        let PlayingFee = 0

        if (this.games[groupId].gameType === 1) {
            const hostUser = this.games[groupId].hostjid ? getUser(this.games[groupId].hostjid) : null
            if (hostUser && hostUser.francs >= 5) {
                await SaveUsersfrancs(this.games[groupId].hostjid, whatsapp, -5, "a lancé une partie de loup avec mise en jeu", "WORDGAME", 0, this.games[groupId])
                let user = getUser(whatsapp.senderJid);
                if (user) {
                    if (user.LastWordGame && Date.now() - user.LastWordGame < 24 * 60 * 60 * 1000) {
                        if (user.wordGameCreated > 0) {
                            user.wordGameCreated = (user.wordGameCreated) - 1;
                        } else {
                            const nextCreationTime = user.LastWordGame + 24 * 60 * 60 * 1000;
                            const nextCreationDate = new Date(nextCreationTime);
                            await whatsapp.sendMessage(groupId, "🧩 Tu as déjà créé trop de parties de mots ! Tu dois attendre jusqu'au " + nextCreationDate.toLocaleString() + " avant d'en créer une autre.");
                            delete this.games[groupId]
                            this.saveGame(this.games)
                            return;
                        }
                    } else {
                        user.LastWordGame = Date.now();
                        user.wordGameCreated = 3;
                    }
                    saveUser(user);
                }

            } else if (hostUser && hostUser.francs < 5) {
                await whatsapp.sendMessage(groupId, "⚠️ Le créateur de la partie n'a pas assez de francs pour lancer une partie avec mise en jeu. Partie annulée.\nEnvoyez *!mots* pour réessayer.")
                delete this.games[groupId]
                this.saveGame(this.games)
                return
            } else {
                await whatsapp.sendMessage(groupId, "❌ Une érreur est survenue lors de la vérification des francs du créateur de la partie. Partie annulée.\nEnvoyez *!mots* pour réessayer.")
                delete this.games[groupId]
                this.saveGame(this.games)
                return
            }
        } else {
            const allUsers = getAllUsers()
            const averagefrancsPerUser = Object.values(allUsers).reduce((sum, user) => sum + (user.francs || 0), 0) / allUsers.length
            console.log(`Average francs per user: ${averagefrancsPerUser}`)
            if (averagefrancsPerUser / 5 > 10)
                PlayingFee = Math.floor(Math.ceil(averagefrancsPerUser / 5) / 10) * 10
        }


        await whatsapp.sendMessage(
            groupId,
            `🎮 *Début du jeu de lettres !*\n\nRejoignez la partie avec *!play _pseudo_* dans les prochains 120 secondes !` + (game.gameType == 2 ? "\n\n💸 Une partie de mots coutera *" + game.misePerUser + " francs* et vous remportez le totale des francs misé" : "🪙 partie normale, sans mise"));

        // Timer de 90 secondes pour rejoindre
        this.games[groupId].timer = setTimeout(async () => {
            await this.startGame(groupId, whatsapp);
        }, 120 * 1000);

        // Rappels
        setTimeout(async () => {
            if (this.games[groupId]?.state === "WAITING_PLAYERS") {
                await whatsapp.sendMessage(groupId, "⏰ 60 secondes restantes pour rejoindre !" + (game.gameType === 2 ? "\n\n💸 Partie avec mise de *" + game.mise + " francs*" : "\n\n🪙 Partie normale, pas de mise en jeu"));
            }
        }, 60 * 1000);

        setTimeout(async () => {
            if (this.games[groupId]?.state === "WAITING_PLAYERS") {
                await whatsapp.sendMessage(groupId, "⏰ 30 secondes restantes pour rejoindre !" + (game.gameType === 2 ? "\n\n💸 Partie avec mise de *" + game.mise + " francs*" : "\n\n🪙 Partie normale, pas de mise en jeu"));
            }
        }, 90 * 1000);
    }

    async joinGame(groupId, playerJid, pseudo, whatsapp) {
        const game = this.games[groupId];
        if (!game || game.state !== "WAITING_PLAYERS") {
            await whatsapp.sendMessage(groupId, "❌ Aucune partie en attente de joueurs !");
            return;
        }

        if (game.players.some(p => p.jid === playerJid)) {
            await whatsapp.sendMessage(groupId, "❌ Tu as déjà rejoint la partie !");
            return;
        }

        const user = getUser(playerJid)
        if (user) {
            user.lid = whatsapp.ids.lid || user.lid || null
            saveUser(user)
        }
        if (game.gameType === 2 && user.francs < game.misePerUser) {
            await whatsapp.sendMessage(groupId, "⚠️ Tu n'as pas assez de francs pour rejoindre une partie avec mise en jeu.");
            return;
        }

        game.players.push({
            jid: playerJid,
            words: [],
            score: 0,
            currentWord: null,
            currentScore: 0,
            points: [],
            name: pseudo || whatsapp.raw?.pushName || `Joueur-${game.players.length + 1}`
        });
        game.mise += game.gameType === 2 ? game.misePerUser : 0
        this.saveGame();

        this.addUserPoints(playerJid, whatsapp, game.gameType === 2 ? -game.misePerUser : 0, "a rejoint une partie de mots", 0, game)

        const names = game.players.map((p, i) => `[${i + 1}] - *${p.name}* (@${p.jid.split('@')[0]}) ` + (!p.isDead ? `😀` : `☠️ [${p.role}]`)).join("\n")
        const mentions = game.players.map((p, i) => p.jid)

        await whatsapp.sendMessage(groupId, `✅ Tu as rejoint!\n\nListe des joueurs:\n\n${names}`, mentions)
    }

    async startGame(groupId, whatsapp) {
        const game = this.games[groupId];
        if (!game || game.state !== "WAITING_PLAYERS") return;

        const playerCount = game.players.length;
        if (playerCount <= 0) {
            await whatsapp.sendMessage(groupId, "❌ Pas assez de joueurs pour commencer la partie !");
            delete this.games[groupId];
            this.saveGame();
            return;
        }

        game.state = "PLAYING";
        game.currentRound = 1;
        this.saveGame();

        await whatsapp.sendMessage(
            groupId,
            `🎮 *Début de la partie !*`
        );

        await this.startRound(groupId, whatsapp);
    }

    async startRound(groupId, whatsapp) {
        const game = this.games[groupId];
        if (!game || game.state !== "PLAYING") return;


        const letters = this.generateLetters();
        game.letters = letters;
        this.saveGame();

        await whatsapp.sendMessage(
            groupId,
            `🔄 *Manche ${game.currentRound}/${game.totalRounds}*\n\nVous avez 90 secondes pour proposer un mot !\n\nLettres : \n*${game.letters.join(" ")}*` + (game.gameType === 2 ? "\n\n💸 Partie avec mise de *" + game.mise + " francs*" : "\n\n🪙 Partie normale, pas de mise en jeu"),
            game.players.map(p => p.jid)
        );

        // Réinitialiser les mots actuels pour cette manche
        game.players.forEach(player => {
            player.currentWord = null;
            player.currentScore = 0;
        });
        this.saveGame();

        // Timer de la manche (30 secondes)
        game.roundTimer = setTimeout(async () => {
            await this.endRound(groupId, whatsapp);
        }, 90 * 1000);
        // Timer de la manche (30 secondes)
        game.roundTimer = setTimeout(async () => {
            await whatsapp.sendMessage(groupId, `⏰ 30 secondes restantes !\n\nLettres : \n*${game.letters.join(" ")}*` + (game.gameType === 2 ? "\n\n💸 Partie avec mise de *" + game.mise + " francs*" : "\n\n🪙 Partie normale, pas de mise en jeu"));
        }, 60 * 1000);
        // Timer de la manche (30 secondes)
        game.roundTimer = setTimeout(async () => {
            await whatsapp.sendMessage(groupId, `⏰ 15 secondes restantes !\n\nLettres : \n*${game.letters.join(" ")}*` + (game.gameType === 2 ? "\n\n💸 Partie avec mise de *" + game.mise + " francs*" : "\n\n🪙 Partie normale, pas de mise en jeu"));
        }, 75 * 1000);
    }

    async endRound(groupId, whatsapp) {
        const game = this.games[groupId];
        if (!game || game.state !== "PLAYING") return;

        // Ajouter les scores de la manche aux scores totaux
        game.players.forEach(player => {
            if (player.currentWord) {
                player.score += player.currentScore;
                player.words.push(player.currentWord);
            }
        });
        this.saveGame();

        // Vérifier si c'est la dernière manche
        if (game.currentRound >= game.totalRounds) {
            await this.endGame(groupId, whatsapp);
        } else {
            game.currentRound++;
            this.saveGame();
            await this.startRound(groupId, whatsapp);
        }
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

    async handleWord(whatsapp) {
        const groupId = whatsapp.groupJid;
        const word = whatsapp.text.trim().toUpperCase();
        const game = this.games[groupId];
        const player = game.players.find(p => p.jid === whatsapp.senderJid);


        if (!game || game.state !== "PLAYING") return;

        // Vérifier que le joueur est dans la partie
        if (!player) {
            // await whatsapp.sendMessage(groupId, "❌ Tu n'es pas dans cette partie !");
            return;
        }

        const letters = [...game.letters];
        for (const char of word) {
            const idx = letters.indexOf(char);
            if (idx === -1) {
                await whatsapp.sendMessage(groupId, `❌ @${player.jid.split('@')[0]} la Lettre "${char}" n'est pas parmit les lettres que tu peux utiliser !`, [player.jid]);
                return;
            }
            letters.splice(idx, 1);
        }


        if (game.players.some(p => p.currentWord === word)) {
            await whatsapp.sendMessage(groupId, `❌ @${player.jid.split('@')[0]} Le mot *"${word}"* a déjà été proposé par un autre joueur dans cette manche! remet toi en question!`, [player.jid]);
            return;
        }

        const wordDef = await parseWiktionary(word);

        if (!wordDef || !wordDef.found) {
            await whatsapp.sendMessage(groupId, `❌ @${player.jid.split('@')[0]} Le mot "${word}" n'existe ni en anglais, ni en français, fallait faire l'école.`, [player.jid]);
            return;
        }

        const score = word.length; // 1 point par lettre

        if (player.currentWord) {
            await whatsapp.sendMessage(groupId, `🔄️ @${player.jid.split('@')[0]} a remplacé *"${player.currentWord}"* par *"${word}"*`, [player.jid]);
        } else {
            await whatsapp.sendMessage(groupId, `✅ @${player.jid.split('@')[0]} a proposé *"${word}"* (+${score} points)`, [player.jid]);
        }
        // Remplacer le mot actuel du joueur
        player.currentWord = word;
        player.currentScore = score;
        this.saveGame();
    }

    async endGame(groupId, whatsapp) {
        const game = this.games[groupId];
        if (!game) return;

        game.state = "ENDED";

        // Trier les joueurs par score
        const results = game.players
            .map(player => ({
                jid: player.jid,
                name: player.name,
                score: player.score,
                words: player.words
            })).sort((a, b) => b.score - a.score);

        // Préparer le podium
        const podium = results
            .map(
                (data, i) =>
                    (i == 0 ? '🥇' : i == 1 ? '🥈' : i == 2 ? '🥉' : '[' + (i + 1) + '] - ') + ` @${data.jid.split('@')[0]} — *${data.score} lettres*`
            )
            .join("\n\n");

        await whatsapp.sendMessage(
            groupId,
            `🏆 *Fin du jeu !*\n\nClassement final :\n\n${podium}`,
            results.map(r => r.jid)
        );

        // Donner les points au gagnant
        const winner = results[0];
        const winner2 = results[1];
        const winner3 = results[2];
        const pointsToAdd = (game.players.length * 2 - Math.round(game.players.length / 2)) * 2;
        const pointsToAdd2 = pointsToAdd - Math.round(game.players.length / 2);
        const pointsToAdd3 = pointsToAdd - Math.round(game.players.length / 2) * 2;

        if (game.gameType == 1) {
            await whatsapp.sendMessage(
                groupId,
                `🎉 @${winner.jid.split('@')[0]} reçoit *${pointsToAdd} points* !\n` +
                `🎉 @${winner2.jid.split('@')[0]} reçoit *${pointsToAdd2} points* !\n` +
                `🎉 @${winner3.jid.split('@')[0]} reçoit *${pointsToAdd3} points* !\n`
                ,
                [winner.jid]
            );

            await this.addUserPoints(winner.jid, whatsapp, pointsToAdd, "Gagnant du jeu de mots", 0, game);
            await this.addUserPoints(winner2.jid, whatsapp, pointsToAdd2, "2eme Gagnant du jeu de mots", 0, game);
            await this.addUserPoints(winner3.jid, whatsapp, pointsToAdd3, "3eme Gagnant du jeu de mots", 0, game);
        } else {

            const totalPoints = results[0].score + results[1].score + results[2].score
            const paidMise = game.mise * (95 / 100)
            await whatsapp.sendMessage(
                groupId,
                `🎉 @${winner.jid.split('@')[0]} reçoit *${Math.round(0.7 * paidMise)} francs* !\n` +
                `🎉 @${winner2.jid.split('@')[0]} reçoit *${Math.round(0.2 * paidMise)} francs* !\n` +
                `🎉 @${winner3.jid.split('@')[0]} reçoit *${Math.round(0.1 * paidMise)} francs* !\n`,
                [winner.jid]
            );

            await this.addUserPoints(winner.jid, whatsapp, Math.round(0.7 * paidMise), "Gagnant du jeu de mots", 0, game);
            await this.addUserPoints(winner2.jid, whatsapp, Math.round(0.2 * paidMise), "2eme Gagnant du jeu de mots", 0, game);
            await this.addUserPoints(winner3.jid, whatsapp, Math.round(0.1 * paidMise), "3eme Gagnant du jeu de mots", 0, game);
        }


        await whatsapp.sendMessage(
            groupId,
            `Envoie *"!mots"* pour jouer à nouveau !`,
        );

        // Save game result to group data
        const groupData = getGroup(groupId)
        if (!groupData) {
            saveGroup({
                jid: groupId,
                games: [
                    {
                        gameType: "MOTS",
                        game: game,
                        time: Date.now()
                    }
                ]
            })
        } else {
            groupData.games.push({
                gameType: "MOTS",
                game: game,
                time: Date.now()
            })
            saveGroup(groupData)
        }
        delete this.games[groupId];
        this.saveGame();
    }

    isPlaying(groupId) {
        return !!this.games[groupId];
    }


    async stopGame(groupId, whatsapp) {
        const game = this.games[groupId]
        if (!game) return

        await whatsapp.sendMessage(groupId, `*🏆 Partie annulé!*`)
        await whatsapp.sendMessage(groupId, `envoie *"!mots"* pour jouer à nouveau`)
        delete this.games[groupId]
        this.saveGame(this.games)
        return
    }

    async handleShortHand(groupId, playerJid, choice, whatsapp) {
        const game = this.games[groupId]
        if (!game) return

        if (game.state === "CHOOSING_GAME_TYPE") {
            await this.chooseGameVote(groupId, playerJid, parseInt(choice), whatsapp)
        }

    }

}