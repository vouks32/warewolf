import fs from "fs"
import path from "path"

const USER_FOLDER = path.join(process.cwd(), "../users")
export const POINTS_LIST = {
    joinGame: 1,
    WinAsVillager: 4,
    WinAsWolve: 6,
    WinAsLover: 8,
    StartSuccessfulGame: 3,
    deathPenatly: -1,
    changeVotePenalty: -2,
    hunterKillsWolf: 4,
    witchPoisonWolf: 4,
    votedWolf: 1,
    votedInnocent: -1
}

export function saveUser(user) {
    if (!fs.existsSync(path.join(USER_FOLDER, user.jid + '.json'))) {
        fs.writeFileSync(path.join(USER_FOLDER, user.jid + '.json'), JSON.stringify(user, null, 2))
        return user
    }

    const SavedUser = JSON.parse(fs.readFileSync(path.join(USER_FOLDER, user.jid + '.json')))
    fs.writeFileSync(path.join(USER_FOLDER, user.jid + '.json'), JSON.stringify({ ...SavedUser, ...user }, null, 2))
    return JSON.parse(fs.readFileSync(path.join(USER_FOLDER, user.jid + '.json')))
}

export function getUser(jid) {
    if (!fs.existsSync(USER_FOLDER)) fs.mkdirSync(USER_FOLDER, { recursive: true })

    if (!fs.existsSync(path.join(USER_FOLDER, jid + '.json'))) return null
    try {
        return JSON.parse(fs.readFileSync(path.join(USER_FOLDER, jid + '.json')))
    } catch (error) {
        return null
    }
}