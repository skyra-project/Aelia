import { Client, Guild, TextChannel, VoiceChannel } from 'discord.js';
import { KlasaMessage, util } from 'klasa';
import { LoadType, Status, Track } from 'lavalink';
import { enumerable } from '../../util/util';
import { Song } from './Song';
import { UserManagerStore } from './UserManagerStore';

export class Queue extends Array<Song> {

	@enumerable(false)
	public client: Client;

	@enumerable(false)
	public guild: Guild;

	@enumerable(false)
	public deejays: UserManagerStore;

	@enumerable(false)
	public channelID: string | null = null;

	public volume = 100;
	public replay = false;
	public song: Song | null = null;

	public get player() {
		return this.client.lavalink.players.get(this.guild.id);
	}

	public get status() {
		const { player } = this;
		return player ? player.status : Status.ENDED;
	}

	public get canPlay() { return Boolean(this.song || this.length); }
	public get playing() { return this.status === Status.PLAYING; }
	public get paused() { return this.status === Status.PAUSED; }
	public get ended() { return this.status === Status.ENDED; }

	public get channel() {
		return (this.channelID && this.client.channels.get(this.channelID) as TextChannel) || null;
	}

	public get playingTime() {
		return this.lastUpdate ? this.position + (Date.now() - this.lastUpdate) : 0;
	}

	public get trackRemaining() {
		return this.song ? this.song.duration - this.playingTime : 0;
	}

	public get voiceChannel() {
		return this.guild.me!.voice.channel;
	}

	public get connection() {
		const { voiceChannel } = this;
		return (voiceChannel && voiceChannel.connection) || null;
	}

	public get listeners() {
		const { voiceChannel } = this;
		return voiceChannel ? voiceChannel.members.map(member => member.id) : [];
	}

	private readonly _listeners: MusicManagerListeners = {
		disconnect: null,
		end: null,
		error: null
	};

	@enumerable(false)
	private position = 0;

	@enumerable(false)
	private lastUpdate = 0;

	public constructor(guild: Guild) {
		super();
		this.client = guild.client;
		this.guild = guild;
		this.deejays = new UserManagerStore(this.client);
	}

	public add(user: string, song: Track | Track[]): this {
		if (Array.isArray(song)) this.push(...song.map(info => new Song(this, info, user)));
		else this.push(new Song(this, song, user));
		return this;
	}

	public async fetch(song: string) {
		const response = await this.client.lavalink.load(song);
		if (response.loadType === LoadType.NO_MATCHES) throw this.guild.language.get('MUSICMANAGER_FETCH_NO_MATCHES');
		if (response.loadType === LoadType.LOAD_FAILED) throw this.guild.language.get('MUSICMANAGER_FETCH_LOAD_FAILED');
		return response.tracks;
	}

	public setReplay(value: boolean) {
		this.replay = value;
		return this;
	}

	public async setVolume(volume: number) {
		if (volume <= 0) throw this.guild.language.get('MUSICMANAGER_SETVOLUME_SILENT');
		if (volume > 200) throw this.guild.language.get('MUSICMANAGER_SETVOLUME_LOUD');
		this.volume = volume;
		await this.player.setVolume(volume);
		return this;
	}

	public async seek(position: number) {
		const { player } = this;
		if (player) await player.seek(position);
		return this;
	}

	public async connect(voiceChannel: VoiceChannel) {
		await this.player.join(voiceChannel.id, { deaf: true });
		return this;
	}

	public async leave() {
		await this.player.leave();
		this.channelID = null;
		this.deejays.clear();
		this.reset(true);
		return this;
	}

	public play() {
		if (!this.voiceChannel) return Promise.reject(this.guild.language.get('MUSICMANAGER_PLAY_NO_VOICECHANNEL'));
		if (!this.length) return Promise.reject(this.guild.language.get('MUSICMANAGER_PLAY_NO_SONGS'));
		if (this.playing) return Promise.reject(this.guild.language.get('MUSICMANAGER_PLAY_PLAYING'));

		return new Promise<void>((resolve, reject) => {
			// Setup the events
			if (this._listeners.end) this._listeners.end(true);
			this._listeners.end = finish => {
				if (this.song && this.replay) {
					this.player.play(this.song.track).catch(reject);
					return;
				}
				this.reset();
				this._listeners.end = null;
				this._listeners.disconnect = null;
				this._listeners.error = null;
				if (finish) resolve();
			};
			this._listeners.error = error => {
				this._listeners.end!(false);
				reject(error);
			};
			this._listeners.disconnect = code => {
				this._listeners.end!(false);
				if (code >= 4000) reject(this.guild.language.get('MUSICMANAGER_PLAY_DISCONNECTION'));
				else resolve();
			};
			this.position = 0;
			this.lastUpdate = 0;
			this.song = this.shift()!;

			this.player.play(this.song.track)
				.catch(reject);
		});
	}

	public async pause() {
		if (!this.paused) await this.player.pause(true);
		return this;
	}

	public async resume() {
		if (!this.playing) await this.player.pause(false);
		return this;
	}

	public async skip() {
		this.setReplay(false);
		const song = this.song || (this.length ? this[0] : null);
		await this.player.stop();
		return song;
	}

	public prune() {
		this.length = 0;
		return this;
	}

	public shuffle() {
		let m = this.length;
		while (m) {
			const i = Math.floor(Math.random() * m--);
			[this[m], this[i]] = [this[i], this[m]];
		}
		return this;
	}

	public receiver(payload: LavalinkEvent) {
		// If it's the end of the track, handle next song
		if (isTrackEndEvent(payload)) {
			if (this._listeners.end) this._listeners.end(true);
			return;
		}

		// If there was an exception, handle it accordingly
		if (isTrackExceptionEvent(payload)) {
			this.client.emit('error', `[LL:${this.guild.id}] Error: ${payload.error}`);
			if (this._listeners.error) this._listeners.error(payload.error);
			if (this.channel) {
				this.channel.sendLocale('MUSICMANAGER_ERROR', [util.codeBlock('', payload.error)])
					.catch(error => { this.client.emit('wtf', error); });
			}
			return;
		}

		// If Lavalink gets stuck, alert the users of the downtime
		if (isTrackStuckEvent(payload)) {
			if (this.channel && payload.thresholdMs > 1000) {
				(this.channel.sendLocale('MUSICMANAGER_STUCK', [Math.ceil(payload.thresholdMs / 1000)]) as Promise<KlasaMessage>)
					.then((message: KlasaMessage) => message.delete({ timeout: payload.thresholdMs }))
					.catch(error => { this.client.emit('wtf', error); });
			}
			return;
		}

		// If the websocket closes badly (code >= 4000), there's most likely an error
		if (isWebSocketClosedEvent(payload)) {
			if (payload.code >= 4000) {
				this.client.emit('error', `[LL:${this.guild.id}] Disconnection with code ${payload.code}: ${payload.reason}`);
				(this.channel!.sendLocale('MUSICMANAGER_CLOSE') as Promise<KlasaMessage>)
					.then((message: KlasaMessage) => message.delete({ timeout: 10000 }))
					.catch(error => { this.client.emit('wtf', error); });
			}
			if (this._listeners.disconnect) this._listeners.disconnect(payload.code);
			this.reset(true);
			return;
		}

		// If it's a player update, update the position
		if (isPlayerUpdate(payload)) {
			this.position = payload.state.position;
			this.lastUpdate = payload.state.time;
			return;
		}

		// If it's a destroy payload, reset this instance
		if (isDestroy(payload)) {
			this.reset(true);
		}
	}

	public async manageableFor(message: KlasaMessage) {
		// The queue is manageable for deejays.
		if (this.deejays.has(message.author!.id)) return true;
		// If the current song and all queued songs are requested by the author, the queue is still manageable.
		if ((this.song ? this.song.requester === message.author!.id : true) && this.every(song => song.requester === message.author!.id)) return true;
		// Else if the author is a moderator+, queues are always manageable for them.
		return message.hasAtLeastPermissionLevel(5);
	}

	private reset(volume = false) {
		this.song = null;
		this.position = 0;
		this.lastUpdate = 0;
		if (volume) this.volume = 100;
	}

}

interface MusicManagerListeners {
	end: ((finish?: boolean) => unknown) | null;
	error: ((error: Error | string) => unknown) | null;
	disconnect: ((code: number) => unknown) | null;
}

/**
 * The basic lavalink node
 */
interface LavalinkEvent {
	op: string;
	type?: string;
	guildId: string;
}

interface LavalinkEndEvent extends LavalinkEvent {
	track: string;
	reason: string;
}

interface LavalinkExceptionEvent extends LavalinkEvent {
	track: string;
	error: string;
}

interface LavalinkStuckEvent extends LavalinkEvent {
	track: string;
	thresholdMs: number;
}

interface LavalinkWebSocketClosedEvent extends LavalinkEvent {
	code: number;
	reason: string;
	byRemote: boolean;
}

interface LavalinkPlayerUpdateEvent extends LavalinkEvent {
	type: never;
	state: {
		time: number;
		position: number;
	};
}

interface LavalinkDestroyEvent extends LavalinkEvent {
	type: never;
}

/**
 * Check if it's an end event
 * @param x The event to check
 */
function isTrackEndEvent(x: LavalinkEvent): x is LavalinkEndEvent {
	return x.type === 'TrackEndEvent';
}

/**
 * Check if it's an exception event
 * @param x The event to check
 */
function isTrackExceptionEvent(x: LavalinkEvent): x is LavalinkExceptionEvent {
	return x.type === 'TrackExceptionEvent';
}

/**
 * Check if it's a stuck event
 * @param x The event to check
 */
function isTrackStuckEvent(x: LavalinkEvent): x is LavalinkStuckEvent {
	return x.type === 'TrackStuckEvent';
}

/**
 * Check if it's a ws closed event
 * @param x The event to check
 */
function isWebSocketClosedEvent(x: LavalinkEvent): x is LavalinkWebSocketClosedEvent {
	return x.type === 'WebSocketClosedEvent';
}

/**
 * Check if it's a player update event
 * @param x The event to check
 */
function isPlayerUpdate(x: LavalinkEvent): x is LavalinkPlayerUpdateEvent {
	return x.op === 'playerUpdate';
}

/**
 * Check if it's a destroy event
 * @param x The event to check
 */
function isDestroy(x: LavalinkEvent): x is LavalinkDestroyEvent {
	return x.op === 'destroy';
}
