const {CompositeDisposable, Disposable} = require('via');
const {dialog} = require('electron').remote;
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const AllowedExtensions = ['.txt', '.json'];
const exchanges = require('./exchanges');
const backwards = ['POLONIEX'];
const url = 'https://alerts.via.world/alerts';

class AlertImporter {
    initialize(){
        this.disposables = new CompositeDisposable(via.commands.add('via-workspace', 'alert-importer:import-file', this.open.bind(this)));
    }

    deactivate(){
        this.disposables.dispose();
        this.disposables = null;
    }

    open(){
        const paths = dialog.showOpenDialog({properties: ['openFile']});

        if(paths){
            paths.forEach(this.convert.bind(this));
        }
    }

    async convert(file){
        if(AllowedExtensions.includes(path.extname(file))){
            try {
                const contents = fs.readFileSync(file);
                const json = JSON.parse(contents);

                if(Array.isArray(json.aaData)){
                    via.console.log(`Preparing to import ${json.aaData.length} alerts.`);

                    if(json.aaData.length > 1000){
                        via.console.warn(`Alerts import truncated.`, `Only the first 1000 of your ${json.aaData.length} alerts have been imported at the current time.`);
                    }

                    const defaults = {
                        expires: via.config.get('alerts.defaultExpiration'),
                        cooldown: via.config.get('alerts.defaultCooldown'),
                        kill: via.config.get('alerts.defaultCancelAfterTrigger'),
                        sms: via.config.get('alerts.defaultSendSMS'),
                        email: via.config.get('alerts.defaultSendEmail')
                    };

                    const alertsToCreate = json.aaData.slice(0, 1000).map(alert => this.create(alert, defaults)).filter(alert => !!alert);

                    await axios.post(`${url}/bulk`, alertsToCreate, {headers: {authorization: 'Bearer ' + via.user.token}})
                    .then(response => via.console.alert(`Successfully imported ${alertsToCreate.length} alerts from "${file}".`))
                    .catch(error => via.console.error(`Failed to create alerts from "${file}".`, error.toString()));
                }else{
                    via.console.error(`Could not import alerts from "${file}".`, 'This import structure is not currently allowed.');
                }
            }catch(error){
                via.console.error(`Could not import alerts from "${file}".`, error.toString());
            }
        }else{
            via.console.error(`Could not import alerts from "${file}".`, 'Only plaintext (.txt) and JSON (.json) files are allowed.');
        }
    }

    create(params, defaults){
        const exchange = exchanges[params.exch_code];
        const [base, quote] = params.mkt_name.split('/');
        const mkt = backwards.includes(exchange) ? `${exchange}_SPOT_${quote}_${base}` : `${exchange}_SPOT_${base}_${quote}`;

        if(!via.markets.get(mkt)){
            return via.console.log(`Could not find market ${params.mkt_name} on ${params.exch_code}.`);
        }

        return {
            value: parseFloat(params.price),
            type: 'last-price',
            market: mkt,
            direction: (params.operator === '>') ? 'above' : 'below',
            sms: defaults.sms,
            email: defaults.email,
            kill: defaults.kill,
            expires: defaults.expires,
            cooldown: defaults.cooldown
        };
    }
}

module.exports = new AlertImporter();
