import fs from "fs"
import path from "path"

const USER_FOLDER = path.join(process.cwd(), "../users")
const GROUP_FOLDER = path.join(process.cwd(), "../groups")

const killWithPowers = 5
export const POINTS_LIST = {
    joinGame: 1,
    WinAsVillager: 6,
    WinAsWolve: 10, 
    WinAsLover: 15,
    StartSuccessfulGame: 0,
    deathPenatly: -1,
    changeVotePenalty: -2,
    wolfEat: 3,
    hunterKillsWolf: killWithPowers,
    witchPoisonWolf: killWithPowers,
    votedWolf: killWithPowers,
    votedInnocent: -2,
    didntVote: -5,
    prostituteProtected: killWithPowers,
    doctorProtected: killWithPowers,
    witchProtected: killWithPowers,
    cupidonlinkWolf: killWithPowers,
    votedAsTanner : 10,
}

export const FRANCS_LIST = {
    joinGame: 0,
    WinAsVillager: 6,
    WinAsWolve: 8, 
    WinAsLover: 10,
    StartSuccessfulGame: 0,
    deathPenatly: -3,
    changeVotePenalty: -5,
    wolfEat: 3,
    hunterKillsWolf: killWithPowers,
    witchPoisonWolf: killWithPowers,
    votedWolf: killWithPowers,
    votedInnocent: -10,
    didntVote: -15,
    prostituteProtected: killWithPowers,
    doctorProtected: killWithPowers,
    witchProtected: killWithPowers,
    cupidonlinkWolf: killWithPowers,
    votedAsTanner : 7,
}

export function saveUser(user) {
    if (!fs.existsSync(path.join(USER_FOLDER, user.jid + '.json'))) {
        fs.writeFileSync(path.join(USER_FOLDER, user.jid + '.json'), JSON.stringify({
            ...user,
            roleHistory: {} // Nouveau champ pour l'historique des rôles par groupe
        }, null, 2))
        return user
    }

    const SavedUser = JSON.parse(fs.readFileSync(path.join(USER_FOLDER, user.jid + '.json')))
    fs.writeFileSync(path.join(USER_FOLDER, user.jid + '.json'), JSON.stringify({ 
        ...SavedUser, 
        ...user,
        // Conserver l'historique des rôles lors des mises à jour
        roleHistory: SavedUser.roleHistory || {}
    }, null, 2))
    return JSON.parse(fs.readFileSync(path.join(USER_FOLDER, user.jid + '.json')))
}

export function getUser(jid) {
    if (!fs.existsSync(USER_FOLDER)) fs.mkdirSync(USER_FOLDER, { recursive: true })
    if(!jid) return null
    if (!fs.existsSync(path.join(USER_FOLDER, jid + '.json'))) return null
    try {
        return JSON.parse(fs.readFileSync(path.join(USER_FOLDER, jid + '.json')))
    } catch (error) {
        return null
    }
}

export function saveGroup(group) {
    if (!fs.existsSync(path.join(GROUP_FOLDER, group.jid + '.json'))) {
        fs.writeFileSync(path.join(GROUP_FOLDER, group.jid + '.json'), JSON.stringify({
            ...group,
            roleHistory: {} // Nouveau champ pour l'historique des rôles par groupe
        }, null, 2))
        return group
    }

    const SavedGroup = JSON.parse(fs.readFileSync(path.join(GROUP_FOLDER, group.jid + '.json')))
    fs.writeFileSync(path.join(GROUP_FOLDER, group.jid + '.json'), JSON.stringify({ 
        ...SavedGroup, 
        ...group,
        // Conserver l'historique des rôles lors des mises à jour
        roleHistory: SavedGroup.roleHistory || {}
    }, null, 2))
    return JSON.parse(fs.readFileSync(path.join(GROUP_FOLDER, group.jid + '.json')))
}

export function getGroup(jid) {
    if (!fs.existsSync(GROUP_FOLDER)) fs.mkdirSync(GROUP_FOLDER, { recursive: true })
    if(!jid) return null
    if (!fs.existsSync(path.join(GROUP_FOLDER, jid + '.json'))) return null
    try {
        return JSON.parse(fs.readFileSync(path.join(GROUP_FOLDER, jid + '.json')))
    } catch (error) {
        return null
    }
}

export function getAllUsers() {
    if (!fs.existsSync(USER_FOLDER)) fs.mkdirSync(USER_FOLDER, { recursive: true })

    const playerFileList = fs.readdirSync(USER_FOLDER)
    let players = {}
    playerFileList.forEach(pfile => {
        players[pfile.replace('.json', '')] = JSON.parse(fs.readFileSync(path.join(USER_FOLDER, pfile)))
    })
    return players
}

export function SaveUsersPoints(playerJid, whatsapp, points, reason, gameType, gamescount, game) {

     if (!playerJid || !whatsapp || !reason) return false
            console.log(`Adding ${points} points to ${playerJid} for ${reason}`, whatsapp?.ids)
            let user = getUser(playerJid)
            let arr = {}
            arr[reason] = points
    
            if (!user) {
                saveUser({ jid: playerJid, lid: whatsapp.ids?.lid || null, groups: [whatsapp.groupJid], dateCreated: Date.now(), pushName: whatsapp.raw?.pushName || ' ', games: { [gameType]: gamescount }, points: 50, pointsTransactions: [arr] })
    
            } else {
                if (!user.groups.some(g => g === whatsapp.groupJid)) {
                    user.groups.push(whatsapp.groupJid)
                }
                if (whatsapp?.ids?.lid && whatsapp.ids?.lid !== user.lid && whatsapp.sender === playerJid) {
                    user.lid = whatsapp.ids.lid
                }
                user.points += points
                user.games[gameType] = (user.games[gameType] || 0) + gamescount
                user.pointsTransactions.push(arr)
                user = saveUser(user)
            }
    
           if(!game) return null
            const Player = game?.players?.find(p => p.jid === playerJid)
            if (Player)
                Player.points?.push({ points, reason })
    
            return game
}
export function SaveUsersfrancs(playerJid, whatsapp, points, reason, gameType, gamescount, game = null) {

     if (!playerJid || !whatsapp || !reason) return false
            console.log(`Adding ${points} francs to ${playerJid} for ${reason}`, whatsapp?.ids)
            let user = getUser(playerJid)
            let arr = {}
            arr[reason] = points
    
            if (!user) {
                saveUser({ jid: playerJid, lid: whatsapp.ids?.lid || null, groups: [whatsapp.groupJid], dateCreated: Date.now(), pushName: whatsapp.raw?.pushName || ' ', games: { [gameType]: gamescount }, points: 50, francs : 0, pointsTransactions: [arr] })
    
            } else {
                if (!user.groups.some(g => g === whatsapp.groupJid)) {
                    user.groups.push(whatsapp.groupJid)
                }
                if (whatsapp?.ids?.lid && whatsapp.ids?.lid !== user.lid && whatsapp.sender === playerJid) {
                    user.lid = whatsapp.ids.lid
                }
                user.francs += points
                user.games[gameType] = (user.games[gameType] || 0) + gamescount
                user.pointsTransactions.push(arr)
                user = saveUser(user)
            }
    
            if(!game) return null
            const Player = game?.players?.find(p => p.jid === playerJid)
            if (Player)
                Player.points?.push({ points, reason })
    
            return game
}

