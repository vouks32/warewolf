import fs from "fs";
import path from "path";
import { getUser, saveUser } from "../userStorage.js";
import { parseWiktionary } from "./guessword-utils/checkword.js";

const DATA_FILE = path.join(process.cwd(), "games/wordgame.json");

const VOWELS = ["A", "E", "I", "O", "U", "Y"];
const CONSONANTS = "BCDFGHJKLMNPQRSTVWXZ".split("");

export class WordGameManager {
    constructor() {
        this.games = this.loadGames();
    }

    // ---------------- UTILS ----------------

    loadGames() {
        return {}
        if (!fs.existsSync(DATA_FILE)) return {}
        return JSON.parse(fs.readFileSync(DATA_FILE))
    }

    saveGames(games) {
        let temp = { ...games }
        Object.entries(temp).forEach(arr => { temp[arr[0]].timer = null })
        fs.writeFileSync(DATA_FILE, JSON.stringify(temp, null, 2))
    }

    generateLetters() {
        const vowelCount = Math.floor(Math.random() * 3) + 2; // entre 2 et 4 voyelles
        const consonantCount = 9 - vowelCount;
        const vowels = Array.from({ length: vowelCount }, () =>
            VOWELS[Math.floor(Math.random() * VOWELS.length)]
        );
        const consonants = Array.from({ length: consonantCount }, () =>
            CONSONANTS[Math.floor(Math.random() * CONSONANTS.length)]
        );
        const letters = [...vowels, ...consonants].sort(() => Math.random() - 0.5);
        return letters;
    }

    async addPoints(playerJid, whatsapp, points, reason) {
        let user = getUser(playerJid);
        if (!user) {
            saveUser({
                jid: playerJid,
                groups: [whatsapp.groupJid],
                points: 50 + points,
                games: { WORDGAME: 1 },
                pointsTransactions: [{ [reason]: points }],
            });
        } else {
            if (!user.groups.includes(whatsapp.groupJid)) user.groups.push(whatsapp.groupJid);
            user.points += points;
            user.games.WORDGAME = (user.games.WORDGAME || 0) + 1;
            user.pointsTransactions.push({ [reason]: points });
            saveUser(user);
        }
    }

    // ---------------- LOGIC ----------------
    async createGame(groupId, whatsapp) {
        if (this.games[groupId]) {
            await whatsapp.reply("🧩 Une partie est déjà en cours !");
            return;
        }

        const letters = this.generateLetters();
        this.games[groupId] = {
            groupId,
            letters,
            state: "WAITING_PLAYERS",
            players: {}, // {jid: {words:[], score:0, currentWord: null, currentScore: 0}}
            timer: null,
            currentRound: 0,
            totalRounds: 10,
            roundTimer: null
        };
        this.saveGames();

        await whatsapp.sendMessage(
            groupId,
            `🎮 *Début du jeu de lettres !*\n\nRejoignez la partie avec *!play _pseudo_* dans les prochains 90 secondes !`
        );

        // Timer de 90 secondes pour rejoindre
        this.games[groupId].timer = setTimeout(async () => {
            await this.startGame(groupId, whatsapp);
        }, 90 * 1000);

        // Rappels
        setTimeout(async () => {
            if (this.games[groupId]?.state === "WAITING_PLAYERS") {
                await whatsapp.sendMessage(groupId, "⏰ 60 secondes restantes pour rejoindre !");
            }
        }, 30 * 1000);

        setTimeout(async () => {
            if (this.games[groupId]?.state === "WAITING_PLAYERS") {
                await whatsapp.sendMessage(groupId, "⏰ 30 secondes restantes pour rejoindre !");
            }
        }, 60 * 1000);
    }

    async joinGame(groupId, playerJid, pseudo, whatsapp) {
        const game = this.games[groupId];
        if (!game || game.state !== "WAITING_PLAYERS") {
            await whatsapp.reply("❌ Aucune partie en attente de joueurs !");
            return;
        }

        if (game.players[playerJid]) {
            await whatsapp.reply("❌ Tu as déjà rejoint la partie !");
            return;
        }

        game.players[playerJid] = {
            jid: playerJid,
            words: [],
            score: 0,
            currentWord: null,
            currentScore: 0,
            name: pseudo || whatsapp.raw?.pushName || `Joueur-${Object.keys(game.players).length + 1}`
        };
        this.saveGames();

        const names = Object.values(game.players).map((p, i) => `[${i + 1}] - *${p.name}* (@${p.jid.split('@')[0]}) ` + (!p.isDead ? `😀` : `☠️ [${p.role}]`)).join("\n")
        const mentions = Object.values(game.players).map((p, i) => p.jid)

        await whatsapp.reply(`✅ Tu as rejoint!\n\nListe des joueurs:\n\n${names}`, mentions)
    }

    async startGame(groupId, whatsapp) {
        const game = this.games[groupId];
        if (!game || game.state !== "WAITING_PLAYERS") return;

        const playerCount = Object.keys(game.players).length;
        if (playerCount <= 0) {
            await whatsapp.sendMessage(groupId, "❌ Pas assez de joueurs pour commencer la partie !");
            delete this.games[groupId];
            this.saveGames();
            return;
        }

        game.state = "PLAYING";
        game.currentRound = 1;
        this.saveGames();

        await whatsapp.sendMessage(
            groupId,
            `🎮 *Début de la partie !*\n\nLettres disponibles : *${game.letters.join(" ")}*\n\n${playerCount} joueur(s) participant(s) !`
        );

        await this.startRound(groupId, whatsapp);
    }

    async startRound(groupId, whatsapp) {
        const game = this.games[groupId];
        if (!game || game.state !== "PLAYING") return;

        await whatsapp.sendMessage(
            groupId,
            `🔄 *Manche ${game.currentRound}/${game.totalRounds}*\n\nVous avez 30 secondes pour proposer un mot !\n\nLettres : *${game.letters.join(" ")}*`
        );

        // Réinitialiser les mots actuels pour cette manche
        Object.keys(game.players).forEach(jid => {
            game.players[jid].currentWord = null;
            game.players[jid].currentScore = 0;
        });
        this.saveGames();

        // Timer de la manche (30 secondes)
        game.roundTimer = setTimeout(async () => {
            await this.endRound(groupId, whatsapp);
        }, 30 * 1000);
    }

    async endRound(groupId, whatsapp) {
        const game = this.games[groupId];
        if (!game || game.state !== "PLAYING") return;

        // Ajouter les scores de la manche aux scores totaux
        Object.keys(game.players).forEach(jid => {
            const player = game.players[jid];
            if (player.currentWord) {
                player.score += player.currentScore;
                player.words.push(player.currentWord);
            }
        });
        this.saveGames();

        // Vérifier si c'est la dernière manche
        if (game.currentRound >= game.totalRounds) {
            await this.endGame(groupId, whatsapp);
        } else {
            game.currentRound++;
            this.saveGames();
            await this.startRound(groupId, whatsapp);
        }
    }

    async handleWord(whatsapp) {
        const groupId = whatsapp.groupJid;
        const word = whatsapp.text.trim().toUpperCase();
        const game = this.games[groupId];

        if (!game || game.state !== "PLAYING") return;

        // Vérifier que le joueur est dans la partie
        if (!game.players[whatsapp.senderJid]) {
            await whatsapp.reply("❌ Tu n'es pas dans cette partie !");
            return;
        }

        const letters = [...game.letters];
        for (const char of word) {
            const idx = letters.indexOf(char);
            if (idx === -1) {
                await whatsapp.reply(`❌ Lettre "${char}" non disponible !`);
                return;
            }
            letters.splice(idx, 1);
        }

        if (!(await parseWiktionary(word)).found) {
            await whatsapp.reply(`❌ Le mot "${word}" n'existe ni en anglais, ni en français, fallait faire l'école.`);
            return;
        }

        const score = word.length; // 1 point par lettre
        const player = game.players[whatsapp.senderJid];

        if (player.currentWord) {
            await whatsapp.reply(`🔄️ Tu as remplacé ton mot actuel *"${player.currentWord}"* par *"${word}"*`);
        } else {
            await whatsapp.reply(`✅ Mot *"${word}"* accepté pour cette manche (+${score} points)`);
        }
        // Remplacer le mot actuel du joueur
        player.currentWord = word;
        player.currentScore = score;
        this.saveGames();
    }

    async endGame(groupId, whatsapp) {
        const game = this.games[groupId];
        if (!game) return;

        game.state = "ENDED";

        // Trier les joueurs par score
        const results = Object.entries(game.players)
            .map(([jid, data]) => ({
                jid,
                name: data.name,
                score: data.score,
                words: data.words
            }))
            .sort((a, b) => b.score - a.score);

        if (results.length === 0) {
            await whatsapp.sendMessage(groupId, "😴 Aucun mot proposé...");
            delete this.games[groupId];
            this.saveGames();
            return;
        }

        // Préparer le podium
        const podium = results
            .map(
                (data, i) =>
                    `${i + 1}. @${data.jid.split('@')[0]} — *${data.score} lettres*`
            )
            .join("\n\n");

        await whatsapp.sendMessage(
            groupId,
            `🏆 *Fin du jeu !*\n\nClassement final :\n\n${podium}`,
            results.map(r => r.jid)
        );

        // Donner les points au gagnant
        const winner = results[0];
        const pointsToAdd = Object.values(game.players).length * 2 - Math.round(Object.values(game.players).length / 2);

        await whatsapp.sendMessage(
            groupId,
            `🎉 @${winner.jid.split('@')[0]} reçoit *${pointsToAdd} points* !`,
            [winner.jid]
        );

        await this.addPoints(winner.jid, whatsapp, pointsToAdd, "Gagnant du jeu de mots");

        delete this.games[groupId];
        this.saveGames();
    }

    isPlaying(groupId) {
        return !!this.games[groupId];
    }
}