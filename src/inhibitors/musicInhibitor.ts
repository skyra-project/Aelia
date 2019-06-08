import { Inhibitor, InhibitorStore } from 'klasa';
import { MusicBitField } from '../lib/structures/MusicBitField';
import { MusicCommand } from '../lib/structures/MusicCommand';
import { AeliaMessage } from '../lib/types/Misc';

const { FLAGS } = MusicBitField;

export default class extends Inhibitor {

	public constructor(store: InhibitorStore, file: string[], directory: string) {
		super(store, file, directory, {
			spamProtection: true
		});
	}

	public async run(message: AeliaMessage, command: MusicCommand): Promise<void> {
		if (!(command instanceof MusicCommand) || !command.music.bitfield) return;

		// MusicCommands only run in text channels
		if (message.channel.type !== 'text') return;

		// Checks for empty queue
		if (command.music.has(FLAGS.QUEUE_NOT_EMPTY) && !message.guild.music.queue.length) {
			throw message.language.get(message.guild.music.playing
				? 'INHIBITOR_MUSIC_QUEUE_EMPTY_PLAYING'
				: 'INHIBITOR_MUSIC_QUEUE_EMPTY');
		}

		// Checks for playing
		if (command.music.has(FLAGS.VOICE_PLAYING) && !message.guild.music.playing) {
			throw message.language.get(message.guild.music.paused
				? 'INHIBITOR_MUSIC_NOT_PLAYING_PAUSED'
				: 'INHIBITOR_MUSIC_NOT_PLAYING_STOPPED');
		}

		// Checks for paused
		if (command.music.has(FLAGS.VOICE_PAUSED) && !message.guild.music.paused) {
			throw message.language.get(message.guild.music.playing
				? 'INHIBITOR_MUSIC_NOT_PAUSED_PLAYING'
				: 'INHIBITOR_MUSIC_NOT_PAUSED_STOPPED');
		}

		if (command.music.has(FLAGS.DJ_MEMBER) && !await message.hasAtLeastPermissionLevel(5)) {
			throw message.language.get('INHIBITOR_MUSIC_DJ_MEMBER');
		}

		const sameVoiceChannel = command.music.has(FLAGS.SAME_VOICE_CHANNEL);
		if (sameVoiceChannel || command.music.has(FLAGS.USER_VOICE_CHANNEL)) {
			if (!message.member!.voice.channelID) throw message.language.get('INHIBITOR_MUSIC_USER_VOICE_CHANNEL');
		}
		if (sameVoiceChannel || command.music.has(FLAGS.AELIA_VOICE_CHANNEL)) {
			if (!message.guild.me!.voice.channelID) throw message.language.get('INHIBITOR_MUSIC_BOT_VOICE_CHANNEL');
		}

		if (sameVoiceChannel && message.member!.voice.channelID !== message.guild.me!.voice.channelID) {
			throw message.language.get('INHIBITOR_MUSIC_BOTH_VOICE_CHANNEL');
		}
	}

}
