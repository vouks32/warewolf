// gameManager.js
import fs from "fs"
import path from "path"
import { getUser, saveUser, POINTS_LIST, getAllUsers } from "../userStorage.js"
import { saveGroups, getGroups } from "../groupStorage.js"

const GROUPS_FILE = path.join(process.cwd(), "GroupManager/group.json")
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

// --- Main Manager ---
export class GroupManager {
    constructor() {
        this.groups = getGroups(); // array of group objects
    }

    _save() {
        saveGroups(this.groups);
    }

    // Find group where user is a member (including leader)
    getUserGroup(jid) {
        return this.groups.find(g => g.members.includes(jid) || g.leader === jid) || null;
    }

    // Find group by exact name (case‑insensitive)
    getGroupByName(name) {
        return this.groups.find(g => g.name.toLowerCase() === name.toLowerCase()) || null;
    }
    getGroupById(id) {
        return this.groups.find(g => g.id === id) || null;
    }

    // Check if user is leader of a given group
    isLeader(jid, group) {
        return group && group.leader === jid;
    }

    // ---------- Leader actions ----------
    async kick(whatsapp, targetJid) {
        const sender = whatsapp.senderJid;
        const group = this.getUserGroup(sender);
        if (!group) return whatsapp.reply("❌ Vous n'appartenez à aucun groupe.");
        if (!this.isLeader(sender, group)) return whatsapp.reply("❌ Seul le chef peut exclure un membre.");
        if (!group.members.includes(targetJid)) return whatsapp.reply("❌ Cette personne n'est pas dans votre groupe.");
        if (targetJid === group.leader) return whatsapp.reply("❌ Vous ne pouvez pas exclure le chef.");

        // Remove from members
        group.members = group.members.filter(jid => jid !== targetJid);
        this._save();

        await whatsapp.reply(`✅ @${targetJid.split('@')[0]} a été exclu du groupe.`, [targetJid]);
        // Notify the kicked user
        await whatsapp.sendMessage(targetJid, `❌ Vous avez été exclu du groupe *${group.name}* par le chef.`);
    }

    async invite(whatsapp, targetJid) {
        const sender = whatsapp.senderJid;
        const group = this.getUserGroup(sender);
        if (!group) return whatsapp.reply("❌ Vous n'appartenez à aucun groupe.");
        if (!this.isLeader(sender, group)) return whatsapp.reply("❌ Seul le chef peut inviter.");
        //if (this.getUserGroup(targetJid)) return whatsapp.reply("❌ Cette personne est déjà dans un groupe.");

        // Check if already invited
        if (group.pendingInvites?.some(inv => inv.userJid === targetJid))
            return whatsapp.reply("❌ Cette personne a déjà une invitation en attente.");

        // Add pending invite
        if (!group.pendingInvites) group.pendingInvites = [];
        group.pendingInvites.push({
            userJid: targetJid,
            invitedBy: sender,
            groupId: group.id,
            timestamp: Date.now()
        });
        this._save();

        await whatsapp.reply(`✅ Invitation envoyée à @${targetJid.split('@')[0]}.`, [targetJid]);
        // Notify target
        await whatsapp.sendMessage(targetJid,
            `📩 Vous avez été invité à rejoindre le groupe *${group.name}*.\n` +
            `Répondez par *!group accept* ou *!group refuse* dans ce chat.`
        );
    }

    // ---------- Invitation handling (by the invited user) ----------
    async acceptInvite(whatsapp) {
        const userJid = whatsapp.senderJid;
        // Find group where user has a pending invite
        const group = this.groups.find(g => g.pendingInvites?.some(inv => inv.userJid === userJid));
        if (!group) return whatsapp.reply("❌ Vous n'avez aucune invitation en attente.");

        // Remove invite, add user to members
        group.pendingInvites = group.pendingInvites.filter(inv => inv.userJid !== userJid);
        this.groups = this.groups.map(g => {
            if (g.members.includes(userJid)) {
                g.members = g.members.filter(jid => jid !== userJid);
            }
            return g;
        });

        if (!group.members.includes(userJid)) group.members.push(userJid);
        this._save();

        await whatsapp.reply(`✅ Vous avez rejoint le groupe *${group.name}* !`);
        // Notify leader
        await whatsapp.sendMessage(group.leader,
            `📢 @${userJid.split('@')[0]} a accepté votre invitation et rejoint le groupe.`,
            [userJid]
        );
    }

    async refuseInvite(whatsapp) {
        const userJid = whatsapp.senderJid;
        const group = this.groups.find(g => g.pendingInvites?.some(inv => inv.userJid === userJid));
        if (!group) return whatsapp.reply("❌ Vous n'avez aucune invitation en attente.");

        group.pendingInvites = group.pendingInvites.filter(inv => inv.userJid !== userJid);
        this._save();

        await whatsapp.reply(`❌ Invitation refusée.`);
        // Notify leader
        await whatsapp.sendMessage(group.leader,
            `❌ @${userJid.split('@')[0]} a refusé votre invitation.`,
            [userJid]
        );
    }

    // ---------- Join requests (by non‑member) ----------
    async requestJoin(whatsapp, groupId) {
        const userJid = whatsapp.senderJid;
        //if (this.getUserGroup(userJid)) return whatsapp.reply("❌ Vous êtes déjà dans un groupe.");

        const group = this.getGroupById(groupId);
        if (!group) return whatsapp.reply("❌ Groupe introuvable. Utilisez *!group list* pour voir les groupes.");

        // Check if already requested
        if (group.pendingRequests?.some(req => req.userJid === userJid))
            return whatsapp.reply("❌ Vous avez déjà une demande en attente pour ce groupe.");

        if (!group.pendingRequests) group.pendingRequests = [];
        group.pendingRequests.push({
            userJid: userJid,
            groupId: group.id,
            timestamp: Date.now()
        });
        this._save();

        await whatsapp.reply(`✅ Demande envoyée au chef du groupe *${group.name}*.`);
        // Notify leader
        await whatsapp.sendMessage(group.leader,
            `📩 @${userJid.split('@')[0]} demande à rejoindre votre groupe *${group.name}*.\n` +
            `Répondez par *!group accept ${userJid.split('@')[0]}* ou *!group refuse ${userJid.split('@')[0]}* dans ce chat. Vous pouvez copier les commandes si dessous`,
            [userJid]
        );
        await whatsapp.sendMessage(group.leader,
            `!group accept ${userJid.split('@')[0]}`,
            [userJid]
        );
        await whatsapp.sendMessage(group.leader,
            `!group refuse ${userJid.split('@')[0]}`,
            [userJid]
        );
    }

    // Leader actions on join requests
    async acceptRequest(whatsapp, targetJid) {
        const sender = whatsapp.senderJid;
        const group = this.getUserGroup(sender);
        if (!group) return whatsapp.reply("❌ Vous n'appartenez à aucun groupe.");
        if (!this.isLeader(sender, group)) return whatsapp.reply("❌ Seul le chef peut accepter une demande.");

        const request = group.pendingRequests?.find(req => req.userJid === targetJid);
        if (!request) return whatsapp.reply("❌ Aucune demande en attente de cette personne.");

        // Remove request, add to members
        group.pendingRequests = group.pendingRequests.filter(req => req.userJid !== targetJid);

        this.groups = this.groups.map(g => {
            if (g.members.includes(userJid)) {
                g.members = g.members.filter(jid => jid !== userJid);
            }
            return g;
        });
        if (!group.members.includes(targetJid)) group.members.push(targetJid);

        this._save();

        await whatsapp.reply(`✅ @${targetJid.split('@')[0]} a rejoint le groupe.`, [targetJid]);
        await whatsapp.sendMessage(targetJid, `✅ Votre demande pour rejoindre *${group.name}* a été acceptée !`);
    }

    async refuseRequest(whatsapp, targetJid) {
        const sender = whatsapp.senderJid;
        const group = this.getUserGroup(sender);
        if (!group) return whatsapp.reply("❌ Vous n'appartenez à aucun groupe.");
        if (!this.isLeader(sender, group)) return whatsapp.reply("❌ Seul le chef peut refuser une demande.");

        const request = group.pendingRequests?.find(req => req.userJid === targetJid);
        if (!request) return whatsapp.reply("❌ Aucune demande en attente de cette personne.");

        group.pendingRequests = group.pendingRequests.filter(req => req.userJid !== targetJid);
        this._save();

        await whatsapp.reply(`❌ Demande de @${targetJid.split('@')[0]} refusée.`, [targetJid]);
        await whatsapp.sendMessage(targetJid, `❌ Votre demande pour rejoindre *${group.name}* a été refusée.`);
    }

    // ---------- Utility: list groups (for admin or public info) ----------
    async listGroups(whatsapp) {
        if (this.groups.length === 0) return whatsapp.reply("Aucun groupe pour le moment.");

        let msg = "📋 *Liste des groupes* 📋\n\n";
        for (const g of this.groups) {
            let groupPoints = g.members.map(m => {
                const user = getUser(m);
                return user ? user.points : 0;
            }).reduce((accumulator, currentValue) => accumulator + currentValue, 0);

            msg += `*${g.name}* (${groupPoints} points)\n`;
            msg += `👑 Chef : @${g.leader.split('@')[0]}\n\n`;
            msg += `👥 Membres (${g.members.length}) : \n${g.members.map(j => '- @' + j.split('@')[0]).join('\n')}\n`;
            if (g.pendingInvites?.length)
                msg += `⏳ Invitations en attente : ${g.pendingInvites.length}\n`;
            if (g.pendingRequests?.length)
                msg += `⏳ Demandes en attente : ${g.pendingRequests.length}\n`;
            msg += "\n";
        }
        const allMentions = this.groups.flatMap(g => [g.leader, ...g.members]);
        await whatsapp.reply(msg, allMentions);
    }

    async initGroups(whatsapp) {
        let players = getAllUsers();
        let playersList = []
        this.groups = []

        for (let player of Object.values(players)) {
            playersList.push(player)
        }

        playersList.sort((a, b) => b.points - a.points)
        let top4 = playersList.slice(0, 4)
        let groupNumber = 0
        for (let player of top4) {
            this.groups.push({
                id: groupNumber,
                name: 'Groupe ' + (groupNumber + 1),
                leader: player.jid,
                members: [player.jid],
            })
            groupNumber++
        }

        let otherplayers = playersList.slice(4).sort(() => Math.random() - 0.5).sort(() => Math.random() - 0.5)
        groupNumber = 0
        for (let player of otherplayers) {
            this.groups[(groupNumber % this.groups.length)].members.push(player.jid)
            groupNumber++
        }


        for (let group of this.groups) {
            let message = `Bienvenue dans *${group.name}* !\n\n`
            message += `Chef de groupe : @${players[group.leader].jid.split('@')[0]}👑\n\n`
            message += `Membres :\n`
            for (let member of group.members) {
                message += `- @${players[member].jid.split('@')[0]}\n`
            }

            for (let member of group.members) {
                await whatsapp.sendMessage(players[member].jid, message, group.members.map(jid => jid))
                await delay(1000)
            }

        }

        this._save();
        this.listGroups(whatsapp)

    }


    // Send a message to all members of the sender's group
    async sendGroupMessage(whatsapp, message) {
        const sender = whatsapp.senderJid;
        const group = this.getUserGroup(sender);
        if (!group) return whatsapp.reply("❌ Vous n'appartenez à aucun groupe.");

        const members = group.members; // includes leader
        for (const member of members) {
            await whatsapp.sendMessage(member, `📢 Message de @${sender.split('@')[0]} :\n\n${message}`);
        }
        await whatsapp.reply("✅ Message envoyé à tous les membres du groupe.");
    }

    // Initiate a leader vote (cost 50 points deducted by the caller)
    async initiateLeaderVote(whatsapp) {
        const sender = whatsapp.senderJid;
        const group = this.getUserGroup(sender);
        if (!group) return whatsapp.reply("❌ Vous n'appartenez à aucun groupe.");

        // Check if a vote is already ongoing
        if (group.leaderVote) {
            const elapsed = (Date.now() - group.leaderVote.startTime) / 1000;
            if (elapsed < 300) {
                return whatsapp.reply("❌ Un vote est déjà en cours dans votre groupe. Patientez jusqu'à la fin.");
            } else {
                // Clean up stale vote
                try {
                    clearTimeout(group.leaderVote?.timeout);
                } catch (error) {

                }
                return await this.tallyLeaderVote(group); // Tally before starting a new one

            }
        }

        // Store vote data
        group.leaderVote = {
            initiator: sender,
            startTime: Date.now(),
            votes: {} // jid -> 'yes' or 'no'
        };

        // Schedule tally after 10 minutes
        const timeout = setTimeout(async () => {
            await this.tallyLeaderVote(group);
        }, 10 * 60 * 1000);
        group.leaderVote.timeout = timeout;

        this._save();

        // Notify all members
        const members = group.members;
        for (const member of members) {
            if (member === sender) continue; // skip initiator? we'll notify them separately
            await whatsapp.sendMessage(member,
                `🗳️ *Vote pour un nouveau chef* 🗳️\n\n` +
                `@${sender.split('@')[0]} propose de devenir le chef du groupe *${group.name}*.\n` +
                `Votez en privé avec moi : *!group vote yes* ou *!group vote no*.\n` +
                `Le vote durera 5 minutes.`,
                [sender]
            );
        }
        await whatsapp.reply("✅ Vote lancé ! Vous recevrez le résultat dans 5 minutes.");
    }

    // Cast a vote (yes/no)
    async castLeaderVote(whatsapp, vote) {
        const voter = whatsapp.senderJid;
        const group = this.getUserGroup(voter);
        if (!group) return whatsapp.reply("❌ Vous n'appartenez à aucun groupe.");
        if (!group.leaderVote) return whatsapp.reply("❌ Aucun vote en cours dans votre groupe.");

        // Check if voter is a member
        if (!group.members.includes(voter)) return whatsapp.reply("❌ Vous n'êtes pas membre de ce groupe.");

        // Check if already voted
        if (group.leaderVote.votes[voter]) return whatsapp.reply("❌ Vous avez déjà voté.");

        // Validate vote
        const v = vote.toLowerCase();
        if (v !== 'yes' && v !== 'no') return whatsapp.reply("❌ Veuillez répondre par *!group vote yes* ou *!group vote no*.");

        // Record vote
        group.leaderVote.votes[voter] = v;
        this._save();

        await whatsapp.reply(`✅ Votre vote (${v === 'yes' ? 'pour' : 'contre'}) a été enregistré.`);
    }

    // Tally votes after timeout
    async tallyLeaderVote(group) {
        const votes = group.leaderVote.votes;
        const initiator = group.leaderVote.initiator;
        let yes = 0, no = 0;
        for (const v of Object.values(votes)) {
            if (v === 'yes') yes++; else no++;
        }

        // Determine outcome
        let resultMessage;
        if (yes > no) {
            // Change leader
            group.leader = initiator;
            resultMessage = `✅ Le vote est terminé ! @${initiator.split('@')[0]} devient le nouveau chef du groupe *${group.name}* avec ${yes} voix pour et ${no} contre.`;
        } else {
            resultMessage = `❌ Le vote est terminé. @${initiator.split('@')[0]} n'est pas élu (${yes} pour, ${no} contre). Le chef reste @${group.leader.split('@')[0]}.`;
        }

        // Clean up vote
        clearTimeout(group.leaderVote.timeout);
        delete group.leaderVote;
        this._save();

        // Notify all members
        const members = group.members;
        for (const member of members) {
            await whatsapp.sendMessage(member, resultMessage, [initiator, group.leader]);
        }
    }


}
